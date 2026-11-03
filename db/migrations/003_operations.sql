ALTER TABLE courses ADD COLUMN return_pending boolean NOT NULL DEFAULT false;
ALTER TABLE courses ADD COLUMN return_of uuid REFERENCES courses(id);
CREATE UNIQUE INDEX one_return_per_course ON courses(return_of) WHERE return_of IS NOT NULL;
ALTER TABLE recurrences ADD COLUMN interval_weeks integer NOT NULL DEFAULT 1 CHECK(interval_weeks BETWEEN 1 AND 4);
GRANT DELETE ON idempotency TO taxilink_app;
