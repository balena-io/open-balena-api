-- These functions call STABLE functions (integer `||` text, `concat_ws`, and
-- `extract` on a timestamptz), so they must not be declared IMMUTABLE.
ALTER FUNCTION "fn_release_semver"("release") STABLE;
ALTER FUNCTION "fn_release_raw version"("release") STABLE;
ALTER FUNCTION "fn_release_version"("release") STABLE;
