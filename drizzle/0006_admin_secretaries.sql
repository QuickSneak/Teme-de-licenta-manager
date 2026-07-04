CREATE UNIQUE INDEX `users_one_secretary_per_faculty_unique` ON `users` (`faculty_id`) WHERE role = 'secretary' AND faculty_id IS NOT NULL;
