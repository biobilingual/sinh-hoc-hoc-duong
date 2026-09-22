CREATE TABLE `students` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL,
  `school` text DEFAULT '' NOT NULL,
  `grade` text NOT NULL,
  `class_name` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `students_grade_class_idx` ON `students` (`grade`, `class_name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_email_idx` ON `students` (`email`);
--> statement-breakpoint
CREATE TABLE `results` (
  `id` text PRIMARY KEY NOT NULL,
  `student_id` text NOT NULL,
  `student_name` text NOT NULL,
  `grade` text NOT NULL,
  `class_name` text NOT NULL,
  `source_id` text NOT NULL,
  `source_title` text NOT NULL,
  `source_type` text NOT NULL,
  `score` real NOT NULL,
  `max_score` real NOT NULL,
  `wrong_questions` text DEFAULT '[]' NOT NULL,
  `completed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `results_completed_idx` ON `results` (`completed_at`);
--> statement-breakpoint
CREATE INDEX `results_source_completed_idx` ON `results` (`source_id`, `completed_at`);
--> statement-breakpoint
CREATE INDEX `results_student_completed_idx` ON `results` (`student_id`, `completed_at`);
--> statement-breakpoint
CREATE TABLE `daily_metrics` (
  `day` text PRIMARY KEY NOT NULL,
  `visits` integer DEFAULT 0 NOT NULL
);
