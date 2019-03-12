## Updating pinejs

When pinejs is updated in open-balena-api, versionbot will attempt to pull in the relevant slice of changelog from pinejs and add it to the changelog in open-balena-api. For this to happen, the commit that updates pinejs must follow a specific format: the first line of the BODY must contain `Update pinejs from x.y.z to x'.y'.z'` The title and footers can be filled in as normal.

N.B. just `Update pinejs from x.y.z to x'.y'.z'` will not be valid as the first line of the commit is the title (please refer to [balena-commit-lint](https://github.com/balena-io/resin-commit-lint) to learn more about how commits should be structured), a valid commit would be:

```
pinejs: Update to v9.0.1

Update pinejs from 9.0.0 to 9.0.1

Change-type: patch
Signed-off-by: Joe Developer <joe.developer@example.com>
```
