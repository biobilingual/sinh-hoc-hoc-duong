CREATE TABLE `student_sessions` (
  `session_hash` text PRIMARY KEY NOT NULL,
  `google_sub` text NOT NULL,
  `email` text NOT NULL,
  `name` text DEFAULT '' NOT NULL,
  `picture` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `student_sessions_email_idx` ON `student_sessions` (`email`);
--> statement-breakpoint
CREATE INDEX `student_sessions_expires_idx` ON `student_sessions` (`expires_at`);
