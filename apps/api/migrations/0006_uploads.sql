-- Files drivers upload straight to S3-compatible storage (SeaweedFS in development) with
-- presigned PUT URLs: document scans for verification, the profile photo riders see and
-- photos of the car. The row is created when the upload URL is handed out and marked ready
-- once the API has checked what actually landed in the bucket (size and file signature).
--
-- The bucket is PRIVATE: passports and licences are personal data (Law ZRU-547; stored in
-- Uzbekistan). Nothing is publicly readable; the API hands out short-lived presigned GET
-- URLs to whoever may see a file (docs/architecture.md "Uploads").
CREATE TABLE uploads (
  id           uuid PRIMARY KEY,
  owner_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- document: private (the owner and operators); profile_photo, vehicle_photo: also shown
  -- to riders of the driver's rides and trips
  purpose      text NOT NULL CHECK (purpose IN ('document', 'profile_photo', 'vehicle_photo')),
  -- u/<owner>/<purpose>/<random>.<ext>
  object_key   text NOT NULL UNIQUE,
  content_type text NOT NULL
                 CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes   int NOT NULL CHECK (size_bytes > 0),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status = 'ready') = (completed_at IS NOT NULL)),
  -- photos are images; a scanned document may also be a PDF
  CHECK (purpose = 'document' OR content_type <> 'application/pdf')
);
CREATE INDEX uploads_owner_idx ON uploads (owner_id, created_at DESC);
-- the housekeeping job deletes uploads that were never completed
CREATE INDEX uploads_pending_idx ON uploads (created_at) WHERE status = 'pending';

-- A document is an uploaded file (upload_id) or, for apps built before uploads, a URL.
ALTER TABLE driver_documents
  ALTER COLUMN url DROP NOT NULL,
  ADD COLUMN upload_id uuid REFERENCES uploads (id),
  ADD CONSTRAINT driver_documents_source_check CHECK ((url IS NULL) <> (upload_id IS NULL));

-- What riders see of the driver and the car once one is assigned.
ALTER TABLE drivers ADD COLUMN photo_upload_id uuid REFERENCES uploads (id);
ALTER TABLE vehicles ADD COLUMN photo_upload_id uuid REFERENCES uploads (id);
