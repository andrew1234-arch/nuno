CREATE TABLE `addresses` (
	`id` integer PRIMARY KEY NOT NULL,
	`addr` blob NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `addresses_addr_unique` ON `addresses` (`addr`);--> statement-breakpoint
CREATE TABLE `cursors` (
	`name` text PRIMARY KEY NOT NULL,
	`block` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `curve_trades` (
	`tx` blob NOT NULL,
	`log_index` integer NOT NULL,
	`block` integer NOT NULL,
	`token` integer NOT NULL,
	`trader` integer NOT NULL,
	`tx_from` integer,
	`side` integer NOT NULL,
	`amount_in` text NOT NULL,
	`amount_out` text NOT NULL,
	PRIMARY KEY(`tx`, `log_index`)
);
--> statement-breakpoint
CREATE INDEX `curve_trades_token_idx` ON `curve_trades` (`token`,`block`);--> statement-breakpoint
CREATE INDEX `curve_trades_trader_idx` ON `curve_trades` (`trader`);--> statement-breakpoint
CREATE INDEX `curve_trades_tx_from_idx` ON `curve_trades` (`tx_from`);--> statement-breakpoint
CREATE TABLE `dex_swaps` (
	`tx` blob NOT NULL,
	`log_index` integer NOT NULL,
	`block` integer NOT NULL,
	`pool` integer NOT NULL,
	`token` integer NOT NULL,
	`sender` integer NOT NULL,
	`recipient` integer NOT NULL,
	`amount0` text NOT NULL,
	`amount1` text NOT NULL,
	PRIMARY KEY(`tx`, `log_index`)
);
--> statement-breakpoint
CREATE INDEX `dex_swaps_token_idx` ON `dex_swaps` (`token`,`block`);--> statement-breakpoint
CREATE TABLE `entity_members` (
	`wallet` integer PRIMARY KEY NOT NULL,
	`entity` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entity_members_entity_idx` ON `entity_members` (`entity`);--> statement-breakpoint
CREATE TABLE `funding_edges` (
	`wallet` integer NOT NULL,
	`funder` integer NOT NULL,
	`origin` integer NOT NULL,
	`kind` integer NOT NULL,
	`value` text NOT NULL,
	`block` integer NOT NULL,
	`block_time` integer NOT NULL,
	`tx` blob NOT NULL,
	`source` integer NOT NULL,
	PRIMARY KEY(`wallet`, `tx`, `funder`)
);
--> statement-breakpoint
CREATE INDEX `funding_edges_origin_idx` ON `funding_edges` (`origin`);--> statement-breakpoint
CREATE TABLE `graduations` (
	`token` integer PRIMARY KEY NOT NULL,
	`pool` integer NOT NULL,
	`block` integer NOT NULL,
	`tx` blob NOT NULL
);
--> statement-breakpoint
CREATE TABLE `labels` (
	`address` integer PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`category` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `link_evidence` (
	`a` integer NOT NULL,
	`b` integer NOT NULL,
	`type` integer NOT NULL,
	`tx` blob NOT NULL,
	`block` integer NOT NULL,
	`token` integer DEFAULT 0 NOT NULL,
	`detail` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`a`, `b`, `type`, `tx`, `detail`)
);
--> statement-breakpoint
CREATE INDEX `link_evidence_b_idx` ON `link_evidence` (`b`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`tx` blob PRIMARY KEY NOT NULL,
	`chain_id` integer NOT NULL,
	`token` integer NOT NULL,
	`source_block` integer NOT NULL,
	`publish_block` integer NOT NULL,
	`evidence_root` blob NOT NULL,
	`gas_used` integer NOT NULL,
	`effective_gas_price` text NOT NULL,
	`published_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `snapshots_token_idx` ON `snapshots` (`token`,`publish_block`);--> statement-breakpoint
CREATE TABLE `storage_stats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`bytes` integer NOT NULL,
	`row_counts` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `token_metrics` (
	`token` integer PRIMARY KEY NOT NULL,
	`source_block` integer NOT NULL,
	`total_supply` text NOT NULL,
	`raw_holders` integer NOT NULL,
	`real_holders` integer NOT NULL,
	`effective_top10_bps` integer NOT NULL,
	`cluster_supply_bps` integer NOT NULL,
	`creator_linked_supply_bps` integer NOT NULL,
	`raw_volume` text NOT NULL,
	`organic_volume` text NOT NULL,
	`organic_volume_bps` integer NOT NULL,
	`evidence_root` blob NOT NULL,
	`computed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` integer PRIMARY KEY NOT NULL,
	`creator` integer NOT NULL,
	`curve_pool` integer NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`create_block` integer NOT NULL,
	`create_tx` blob NOT NULL,
	`graduated_pool` integer,
	`graduated_block` integer,
	`pruned` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tokens_creator_idx` ON `tokens` (`creator`);--> statement-breakpoint
CREATE TABLE `transfers` (
	`tx` blob NOT NULL,
	`log_index` integer NOT NULL,
	`block` integer NOT NULL,
	`token` integer NOT NULL,
	`from` integer NOT NULL,
	`to` integer NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`tx`, `log_index`)
);
--> statement-breakpoint
CREATE INDEX `transfers_token_idx` ON `transfers` (`token`,`block`);--> statement-breakpoint
CREATE INDEX `transfers_from_idx` ON `transfers` (`from`);--> statement-breakpoint
CREATE INDEX `transfers_to_idx` ON `transfers` (`to`);--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` integer PRIMARY KEY NOT NULL,
	`is_contract` integer,
	`funding_status` integer DEFAULT 0 NOT NULL,
	`first_funded_block` integer,
	`funding_attempts` integer DEFAULT 0 NOT NULL,
	`resolved_at` integer
);
