import type { Snapshot } from "@/lib/data";
import { Badge } from "./ui";

type SignalMessage = Pick<
  Snapshot["messages"][number],
  "trackingHash" | "signalCount" | "firstSignal" | "latestSignal"
>;

export function OpenSignalStatus({
  message,
  timeZone,
}: {
  message: SignalMessage;
  timeZone: string;
}) {
  const recorded = message.signalCount > 0;
  const enabled = Boolean(message.trackingHash);
  const label = recorded
    ? "Open signal recorded"
    : enabled
      ? "No signal recorded"
      : "Tracking off";
  const formatTime = (value: string) =>
    new Date(value).toLocaleString("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    });

  return (
    <div className="open-signal-status">
      <Badge tone={recorded ? "blue" : ""}>{label}</Badge>
      {recorded ? (
        <>
          <small>
            {message.signalCount} recorded{" "}
            {message.signalCount === 1 ? "event" : "events"}
          </small>
          {message.firstSignal && (
            <small>
              First:{" "}
              <time dateTime={message.firstSignal} title={timeZone}>
                {formatTime(message.firstSignal)}
              </time>
            </small>
          )}
          {message.latestSignal && (
            <small>
              Latest:{" "}
              <time dateTime={message.latestSignal} title={timeZone}>
                {formatTime(message.latestSignal)}
              </time>
            </small>
          )}
          <small>Image requests; reading unconfirmed.</small>
        </>
      ) : (
        <small>
          {enabled
            ? "Reading status unknown. Images may be blocked."
            : "No open-signal data collected."}
        </small>
      )}
    </div>
  );
}
