/**
 * Which ride's chat is on screen: a chat push for it is not shown as a banner (the message is
 * already in front of the driver); any other push is.
 */
let openRideId: string | null = null;

export function setOpenChat(rideId: string | null): void {
  openRideId = rideId;
}

/** Whether a push (`data: { kind, rideId }`) is a chat message for the chat on screen. */
export function isChatOnScreen(data: unknown): boolean {
  if (!openRideId || typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return d.kind === 'chat' && d.rideId === openRideId;
}
