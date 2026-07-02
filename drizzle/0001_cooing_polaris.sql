CREATE TABLE `documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`filename` varchar(512) NOT NULL,
	`originalName` varchar(512) NOT NULL,
	`fileKey` varchar(1024) NOT NULL,
	`fileUrl` varchar(1024) NOT NULL,
	`mimeType` varchar(128) NOT NULL,
	`fileSize` int NOT NULL DEFAULT 0,
	`extractedText` text,
	`embeddingJson` text,
	`status` enum('processing','ready','error') NOT NULL DEFAULT 'processing',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
