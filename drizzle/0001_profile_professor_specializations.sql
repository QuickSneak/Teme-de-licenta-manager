ALTER TABLE `users` ADD `bio` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE TABLE `professor_specializations` (
	`professor_id` text NOT NULL,
	`specialization_id` integer NOT NULL,
	FOREIGN KEY (`professor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`specialization_id`) REFERENCES `specializations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `professor_specializations_assignment_unique` ON `professor_specializations` (`professor_id`,`specialization_id`);
