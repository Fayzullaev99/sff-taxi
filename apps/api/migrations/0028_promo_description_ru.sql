-- A promo code's description is operator text riders see in their wallet and on the quote;
-- it was Uzbek only, so a Russian app showed Uzbek. Operators may now write a Russian one
-- too (the API answers in the request's language, falling back to the Uzbek text).
ALTER TABLE promo_codes
  ADD COLUMN description_ru text CHECK (char_length(description_ru) <= 300);
