ALTER TABLE "release tag"
	-- It is necessary that each release tag has a tag key that has a Length (Type) that is greater than 0.
	ADD CONSTRAINT "release tag$vGZu47lKJepQVH+hgSZNuUPdet2cG96akz3Yc8hta3A=" CHECK (0 < LENGTH("tag key")
	AND LENGTH("tag key") IS NOT NULL
	AND "tag key" = "tag key"
	AND "tag key" IS NOT NULL)
;

ALTER TABLE "application tag"
	-- It is necessary that each application tag has a tag key that has a Length (Type) that is greater than 0.
	ADD CONSTRAINT "application tag$zPAVMu9ZY2npomham40YGgXx5N6Hau03dIo6x9gf6/E=" CHECK (0 < LENGTH("tag key")
	AND LENGTH("tag key") IS NOT NULL
	AND "tag key" = "tag key"
	AND "tag key" IS NOT NULL)
;

ALTER TABLE "device tag"
	-- It is necessary that each device tag has a tag key that has a Length (Type) that is greater than 0.
	ADD CONSTRAINT "device tag$30aEY0OcDs3I/zbRIyNPL9K/I7WY+4PabIF1sxOvXKg=" CHECK (0 < LENGTH("tag key")
	AND LENGTH("tag key") IS NOT NULL
	AND "tag key" = "tag key"
	AND "tag key" IS NOT NULL)
;
