ALTER TABLE `users` ADD `academic_title` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `office_location` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `working_hours` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `is_hidden` integer DEFAULT false NOT NULL;
