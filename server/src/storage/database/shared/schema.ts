import { pgTable, serial, varchar, text, integer, timestamp, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const healthCheck = pgTable("health_check", {
  id: serial().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const categories = pgTable(
  "categories",
  {
    id: serial().primaryKey(),
    name: varchar("name", { length: 50 }).notNull(),
    icon: varchar("icon", { length: 50 }).notNull().default("tag"),
    color: varchar("color", { length: 20 }).notNull().default("#6C63FF"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("categories_name_idx").on(table.name),
  ]
);

export const items = pgTable(
  "items",
  {
    id: serial().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    category_id: integer("category_id").notNull().references(() => categories.id),
    location: varchar("location", { length: 200 }).notNull().default(""),
    tags: text("tags").notNull().default(""),
    photo_key: text("photo_key").notNull(),
    note: text("note").notNull().default(""),
    borrowed_to: varchar("borrowed_to", { length: 100 }),
    borrowed_at: timestamp("borrowed_at", { withTimezone: true }),
    expiry_date: varchar("expiry_date", { length: 10 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("items_category_id_idx").on(table.category_id),
    index("items_created_at_idx").on(table.created_at),
    index("items_name_idx").on(table.name),
    index("items_location_idx").on(table.location),
  ]
);
