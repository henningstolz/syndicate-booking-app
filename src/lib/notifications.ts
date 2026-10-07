// The events a member can be emailed about. One list, used by the Settings
// tab (labels, descriptions) and checked by the database tests against the
// database's own defaults (notification_default in migration 0013), so the
// two cannot drift apart. No imports, so the tests can load it in plain Node.
export type NotificationEvent =
  | "booking_created"
  | "booking_cancelled"
  | "chat_message"
  | "flight_logged"
  | "defect_reported";

export type NotificationEventInfo = {
  key: NotificationEvent;
  section: "Calendar" | "Chat" | "Tech log";
  label: string;
  description: string;
  // What applies until a member makes their own choice.
  defaultOn: boolean;
};

export const NOTIFICATION_EVENTS: NotificationEventInfo[] = [
  {
    key: "booking_created",
    section: "Calendar",
    label: "New bookings",
    description: "Someone books the aircraft.",
    defaultOn: true,
  },
  {
    key: "booking_cancelled",
    section: "Calendar",
    label: "Cancelled bookings",
    description: "Someone cancels a booking, including an admin cancelling yours.",
    defaultOn: true,
  },
  {
    key: "chat_message",
    section: "Chat",
    label: "New chat messages",
    description: "Someone posts in the group chat.",
    defaultOn: true,
  },
  {
    key: "flight_logged",
    section: "Tech log",
    label: "Flights logged",
    description:
      "Someone adds a flight to the tech log. This comes after every flight, so it is off until you switch it on.",
    defaultOn: false,
  },
  {
    key: "defect_reported",
    section: "Tech log",
    label: "Defects reported",
    description:
      "A logged flight includes a defect. If you also want flights logged, you get this one instead of the routine email for that flight.",
    defaultOn: true,
  },
];

// The most recent chat message, booking and so on are never emailed to the
// person who made them.
export const NOTIFICATION_NOTE =
  "You are never emailed about something you did yourself.";
