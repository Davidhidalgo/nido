export function openOAuthWindow(url: string, popup: Window | null): boolean {
  if (!popup || popup.closed) return false;
  popup.opener = null;
  // OpenClaw serves its UI with Referrer-Policy: no-referrer, which can make
  // navigation POSTs send Origin: null. Change the policy only in our blank
  // popup; retain the initiating document's inherited origin for the form.
  const policy = popup.document.createElement("meta");
  policy.name = "referrer";
  policy.content = "origin";
  popup.document.head.append(policy);
  const form = popup.document.createElement("form");
  form.method = "POST";
  form.action = url;
  popup.document.body.append(form);
  form.submit();
  return true;
}
