-- The language a person uses the apps in (docs/architecture.md §10 "Languages"): the apps
-- send Accept-Language on every request and the API keeps the last one here, so SMS and
-- push sent later by the worker (from the outbox, with no request to read) are written in
-- the person's language. 'uz' (Uzbek Latin) is the default and the operators' language.
ALTER TABLE users
  ADD COLUMN locale text NOT NULL DEFAULT 'uz' CHECK (locale IN ('uz', 'ru'));
