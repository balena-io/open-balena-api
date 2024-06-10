UPDATE "user" SET email = NULL WHERE email = '';

ALTER TABLE "user" 
-- It is necessary that each user (Auth) that has an email, has an email that has a Length (Type) that is greater than 4.
ADD CONSTRAINT "user$M+9koFfMHn7kQFDNBaQZbS7gAvNMB1QkrTtsaVZoETw=" CHECK (NOT (
	"email" IS NOT NULL
	AND NOT (
		4 < LENGTH("email")
		AND LENGTH("email") IS NOT NULL
		AND "email" IS NOT NULL
	)
));
