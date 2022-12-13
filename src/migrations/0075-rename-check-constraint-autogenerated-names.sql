DO
$$
BEGIN

IF EXISTS(
	SELECT 1
	FROM pg_constraint
	WHERE connamespace = 2200 AND contype = 'c'
	AND conname = 'release$69zgYrVSJaN1avGiEeipPlJ9/lMKzOIt3iMPF6u/6WY='
) THEN
	ALTER TABLE IF EXISTS "release" RENAME CONSTRAINT "release$69zgYrVSJaN1avGiEeipPlJ9/lMKzOIt3iMPF6u/6WY="
	TO "release$MzjpQaivUEdIHd8yxsZROP6xf1ujVcnNfmjkedivb/M=";
END IF;

IF EXISTS(
	SELECT 1
	FROM pg_constraint
	WHERE connamespace = 2200 AND contype = 'c'
	AND conname = 'release$RcddhgkY+99IgKXAUId7Q3iN4WylzgAxSFiF+JvyRiY='
) THEN
	ALTER TABLE IF EXISTS "release" RENAME CONSTRAINT "release$RcddhgkY+99IgKXAUId7Q3iN4WylzgAxSFiF+JvyRiY="
	TO "release$4VHBqaOH1cZHOsRGD2NvfC+SbBdzlb1ZY/X5Nf4LYrk=";
END IF;

IF EXISTS(
	SELECT 1
	FROM pg_constraint
	WHERE connamespace = 2200 AND contype = 'c'
	AND conname = 'release tag$vGZu47lKJepQVH+hgSZNuUPdet2cG96akz3Yc8hta3A='
) THEN
	ALTER TABLE IF EXISTS "release tag" RENAME CONSTRAINT "release tag$vGZu47lKJepQVH+hgSZNuUPdet2cG96akz3Yc8hta3A="
	TO "release tag$NvLy4YiKcvnAIsymFg0q5h0woCgrL3NW7FzZLrc6S9E=";
END IF;

IF EXISTS(
	SELECT 1
	FROM pg_constraint
	WHERE connamespace = 2200 AND contype = 'c'
	AND conname = 'application$Rlu1vWu2xL/ssYhMPT7xj1zIn00+4AkgpcvOQN9Lr+s='
) THEN
	ALTER TABLE IF EXISTS "application" RENAME CONSTRAINT "application$Rlu1vWu2xL/ssYhMPT7xj1zIn00+4AkgpcvOQN9Lr+s="
	TO "application$DzrZvRXvI3CeY9zwb2W2yocPFtKIXbg0zeu3OQIJj8A=";
END IF;

IF EXISTS(
	SELECT 1
	FROM pg_constraint
	WHERE connamespace = 2200 AND contype = 'c'
	AND conname = 'application$GZ8FNlwwxFjgC1YvG6LoHCW/ECfWTpQLmNYKUJQoSXI='
) THEN
	ALTER TABLE IF EXISTS "application" RENAME CONSTRAINT "application$GZ8FNlwwxFjgC1YvG6LoHCW/ECfWTpQLmNYKUJQoSXI="
	TO "application$mZf6fIjTFZaZUdsCaYh/lnRvAxaNt8fVao0CoBFRPWM=";
END IF;

IF EXISTS(
	SELECT 1
	FROM pg_constraint
	WHERE connamespace = 2200 AND contype = 'c'
	AND conname = 'application tag$zPAVMu9ZY2npomham40YGgXx5N6Hau03dIo6x9gf6/E='
) THEN
	ALTER TABLE IF EXISTS "application tag" RENAME CONSTRAINT "application tag$zPAVMu9ZY2npomham40YGgXx5N6Hau03dIo6x9gf6/E="
	TO "application tag$dwaIlc8ofrxW9EuuGVg2l/mONXLOEwBOKBKuMMh0y84=";
END IF;

IF EXISTS(
	SELECT 1
	FROM pg_constraint
	WHERE connamespace = 2200 AND contype = 'c'
	AND conname = 'device tag$30aEY0OcDs3I/zbRIyNPL9K/I7WY+4PabIF1sxOvXKg='
) THEN
	ALTER TABLE IF EXISTS "device tag" RENAME CONSTRAINT "device tag$30aEY0OcDs3I/zbRIyNPL9K/I7WY+4PabIF1sxOvXKg="
	TO "device tag$LxFNw830+UStHqiMds2etP37dS5mqJP1LWfVi6p8xO0=";
END IF;

IF EXISTS(
	SELECT 1
	FROM pg_constraint
	WHERE connamespace = 2200 AND contype = 'c'
	AND conname = 'image$EsnlFqzUfM0jeomVNVuB+GgghnPSgJlMCa0zMBA6cV8='
) THEN
	ALTER TABLE IF EXISTS "image" RENAME CONSTRAINT "image$EsnlFqzUfM0jeomVNVuB+GgghnPSgJlMCa0zMBA6cV8="
	TO "image$f+RwXXr0uXiXbinfGuS+2KUJUP/5ZYRn0X2OTXgwKDw=";
END IF;

END;
$$;
