(function () {
  "use strict";
  const form = document.getElementById("joinForm");
  const btn = document.getElementById("submitBtn");
  const formError = document.getElementById("formError");
  const MAX_PROOF = 2 * 1024 * 1024;
  let photoData = null;

  const readAsDataUrl = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Could not read the file"));
    r.readAsDataURL(file);
  });

  const loadImage = async (file) => {
    const url = await readAsDataUrl(file);
    return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("This image could not be opened")); i.src = url; });
  };

  // Crop to a square and shrink to 512px JPEG so uploads stay small on mobile data.
  async function resizePhoto(file) {
    const img = await loadImage(file);
    const size = 512, s = Math.min(img.width, img.height);
    const c = document.createElement("canvas"); c.width = c.height = size;
    c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    return c.toDataURL("image/jpeg", 0.85);
  }

  // Photos of certificates from phone cameras are often 4-8 MB. Shrink them to at most 1600px,
  // which keeps the text readable and the upload well under the limit.
  async function shrinkProofImage(file) {
    const img = await loadImage(file);
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  }

  function setError(name, msg) {
    const el = form.querySelector('.err[data-for="' + name + '"]');
    if (el) el.textContent = msg || "";
    const input = document.getElementById(name);
    if (input) input.setAttribute("aria-invalid", msg ? "true" : "false");
  }
  function clearErrors() {
    form.querySelectorAll(".err").forEach((e) => (e.textContent = ""));
    form.querySelectorAll("[aria-invalid]").forEach((e) => e.removeAttribute("aria-invalid"));
    formError.hidden = true;
  }
  function showFormError(msg) { formError.textContent = msg; formError.hidden = false; formError.scrollIntoView({ behavior: "smooth", block: "center" }); }

  document.getElementById("photo").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    setError("photo", "");
    photoData = null;
    document.getElementById("photoPreview").style.backgroundImage = "";
    if (!f) return;
    try {
      photoData = await resizePhoto(f);
      document.getElementById("photoPreview").style.backgroundImage = "url(" + photoData + ")";
    } catch (err) { setError("photo", err.message); e.target.value = ""; }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors();
    // Browser checks first, so people see problems without a round trip.
    let firstBad = null;
    form.querySelectorAll("input[required], select[required]").forEach((el) => {
      const empty = el.type === "checkbox" ? !el.checked : !el.value.trim();
      if (empty) { setError(el.name || el.id, el.type === "checkbox" ? "Please tick this box to continue" : "This is required"); firstBad = firstBad || el; }
    });
    if (firstBad) { firstBad.focus(); return showFormError("Please fill in the highlighted fields."); }

    const data = Object.fromEntries(new FormData(form));
    data.openToMentor = document.getElementById("openToMentor").checked;
    data.consent = document.getElementById("consent").checked;
    if (photoData) data.photo = photoData;
    const proofFile = document.getElementById("proof").files[0];
    if (proofFile) {
      try {
        const isImage = proofFile.type === "image/jpeg" || proofFile.type === "image/png";
        const proofData = isImage ? await shrinkProofImage(proofFile) : await readAsDataUrl(proofFile);
        if (proofData.length * 0.75 > MAX_PROOF) { setError("proof", "Choose a PDF under 2 MB, or upload a photo of the certificate instead"); return showFormError("The proof document is too large."); }
        data.proof = { name: proofFile.name, data: proofData };
      } catch (err) { setError("proof", err.message); return; }
    }

    btn.disabled = true; btn.textContent = "Submitting…";
    try {
      const res = await fetch("/api/v1/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      const body = await res.json().catch(() => ({}));
      if (res.status === 201) {
        form.hidden = true;
        document.getElementById("doneName").textContent = body.name.split(" ")[0];
        const done = document.getElementById("done"); done.hidden = false; done.focus();
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (res.status === 400 && body.fields) {
        Object.entries(body.fields).forEach(([k, v]) => setError(k, v));
        const first = Object.keys(body.fields)[0];
        const el = document.getElementById(first); if (el) el.focus();
        return showFormError(body.message || "Some details need fixing.");
      }
      if (res.status === 429) return showFormError("Too many attempts from this connection. Please try again in an hour.");
      showFormError(body.message || "Something went wrong. Please try again.");
    } catch (err) {
      showFormError("Could not reach the server. Check your internet connection and try again.");
    } finally {
      btn.disabled = false; btn.textContent = "Submit registration";
    }
  });
})();
