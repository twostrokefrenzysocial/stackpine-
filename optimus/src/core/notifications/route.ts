/**
 * Where a tapped Optimus notification takes the user. Pure, so it's testable
 * without the native notification module.
 */
export interface Notice {
  title: string;
  body: string;
  /** For suggestions: what to ask Optimus to act on it. */
  ask?: string;
}

export function hrefForNotification(
  data: Record<string, unknown> | undefined,
): string {
  const url = typeof data?.url === "string" ? data.url : "";
  if (url.includes("voice")) return "/voice";
  if (url.includes("brief")) return "/brief";
  const notice = data?.notice as Notice | undefined;
  // Show what the notification said, in a chat, so the user can act on it right there.
  if (notice && typeof notice.title === "string")
    return `/chat/new?notice=${encodeURIComponent(JSON.stringify(notice))}`;
  return "/";
}
