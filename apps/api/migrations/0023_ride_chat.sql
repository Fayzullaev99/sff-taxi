-- Ride chat (docs/architecture.md §9 "Ride chat"): the rider and the driver write to each
-- other from the driver's assignment until a short while after the ride (src/lib/chat.ts),
-- then it is read-only. Operators read it for complaints and safety. Text only.
CREATE TABLE ride_messages (
  id                 uuid PRIMARY KEY,
  ride_id            uuid NOT NULL REFERENCES rides (id),
  -- the ride's driver when it was written: a driver taken off the ride does not read the next
  -- driver's conversation with the rider, nor the next driver theirs
  driver_id          uuid NOT NULL REFERENCES drivers (user_id),
  author_id          uuid NOT NULL REFERENCES users (id),
  author_role        text NOT NULL CHECK (author_role IN ('rider', 'driver')),
  text               text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 500),
  -- a quick reply's key ("coming_out"): the text is stored too
  quick_reply        text CHECK (char_length(quick_reply) <= 40),
  -- the app's id for the message: a retry after a lost answer is not sent twice
  client_message_id  uuid,
  -- when the other side read it (read receipts, unread counters)
  read_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ride_messages_ride_idx ON ride_messages (ride_id, id);
CREATE UNIQUE INDEX ride_messages_client_idx ON ride_messages (author_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
CREATE INDEX ride_messages_unread_idx ON ride_messages (ride_id, author_role)
  WHERE read_at IS NULL;
