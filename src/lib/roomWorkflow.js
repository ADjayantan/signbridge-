export function meetingSummary(card) {
  const fields = card?.fields || {};
  const details = [["Date", fields.date], ["Time", fields.time], ["Time zone", fields.timeZone], ["Place", fields.place], ["Note", fields.note]]
    .map(([label, value]) => `${label}: ${value || "Not specified"}`).join(". ");
  const count = new Set(card?.approvals || []).size;
  return `Meeting details, revision ${card?.revision || 1}. ${details}. ${count === 2 ? "Both approved these details" : count === 1 ? "One participant approved; the other approval is pending" : "Awaiting both approvals"}.`;
}

export function referenceSummary(reference) {
  return `Reference: ${reference.label}. Description: ${reference.description}. Revision ${reference.revision || 1}.`;
}

export function messageSummary(message, messages = []) {
  const relation = message.relation?.kind === "correction" ? "Correction: " : message.relation?.kind === "answer" ? "Clarification answer: " : "";
  const original = messages.find((item) => item.id === message.relation?.messageId);
  const context = message.relation ? original ? ` Original message: ${original.text}.` : " The original message is no longer in the retained history." : "";
  return `${relation}${message.text}${context}${message.references?.length ? `. ${message.references.map(referenceSummary).join(" ")}` : ""}`;
}

export function workflowEventSummary(event, messages = []) {
  if (event.kind?.startsWith("meeting.")) return meetingSummary(event.card || event.meeting || {});
  if (event.kind?.startsWith("reference.")) return referenceSummary(event.reference || {});
  if (event.kind?.startsWith("clarification.")) {
    const clarification = event.clarification || {};
    const original = messages.find((message) => message.id === clarification.messageId);
    const context = original ? ` About the message: ${original.text}.` : " The original message is no longer in the retained history.";
    if (event.kind === "clarification.resolve") return `Partner marked the clarification request resolved.${clarification.question ? ` Request: ${clarification.question}.` : ""}${context}`;
    return `Partner requested clarification: ${clarification.question || (clarification.reason === "time-place" ? "Which time or place?" : "Please repeat or rephrase this message")}.${context}`;
  }
  return "Conversation details updated.";
}
