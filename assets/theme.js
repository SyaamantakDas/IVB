// Light or dark: the visitor's choice, kept in this browser, or else the device's own setting.
// Loaded in the <head> of every page, before the styles, so a page never shows the wrong colours first;
// then it wires up the switch (hidden until this runs, so a page without scripts simply follows the device).
(() => {
  const KEY = "ivb-theme"; // as the app's other settings: "ivb-" and a JSON value
  const root = document.documentElement;
  const read = () => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY));
      return v === "light" || v === "dark" ? v : "auto";
    } catch {
      return "auto";
    }
  };
  const apply = (theme) => {
    if (theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = theme;
  };
  apply(read());

  const wire = () => {
    const radios = [...document.querySelectorAll('input[name="ivb-theme"]')];
    if (!radios.length) return;
    const show = (theme) => radios.forEach((r) => (r.checked = r.value === theme));
    show(read());
    for (const r of radios)
      r.addEventListener("change", () => {
        if (!r.checked) return;
        try {
          if (r.value === "auto") localStorage.removeItem(KEY);
          else localStorage.setItem(KEY, JSON.stringify(r.value));
        } catch {
          /* no storage: the choice holds until the page is left */
        }
        apply(r.value);
      });
    // the choice made in another tab
    window.addEventListener("storage", (e) => {
      if (e.key !== KEY && e.key !== null) return;
      const theme = read();
      apply(theme);
      show(theme);
    });
    for (const f of document.querySelectorAll(".theme")) f.hidden = false;
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
