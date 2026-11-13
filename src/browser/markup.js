// Shared markup for the server pages, the reporter, and saved reports.

let clean = (value) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '�');

export let escapeMarkup = (value) =>
  clean(value).replace(
    /[<>&"']/g,
    (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]
  );

// The wordmark: "dyn" with a roller drum for the o. The knurl spins while tests run.
export let wordmark = '<span class="wordmark" aria-hidden="true">dyn<svg class="roller" viewBox="0 0 40 40"><circle class="roller-drum" cx="20" cy="20" r="15.5"/><g class="roller-knurl"><path d="M20 4.5v5M20 30.5v5M4.5 20h5M30.5 20h5M9 9l3.5 3.5M27.5 27.5L31 31M31 9l-3.5 3.5M12.5 27.5L9 31"/></g><circle class="roller-hub" cx="20" cy="20" r="4"/></svg></span>';
