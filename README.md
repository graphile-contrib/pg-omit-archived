# @graphile-contrib/pg-omit-archived

This Graphile Engine plugin can be used to give your schema support for
"soft-deletes" - where you set an `is_archived` or `is_deleted` column to true
and expect the record to be omitted by default (but it's still available to
be recovered should you need to).

## Installing

This requires `postgraphile@^4.0.1`

```
yarn add postgraphile @graphile-contrib/pg-omit-archived
```

(Or replace `yarn add` with `npm install --save` if you use npm.)

## Usage

Add a boolean column `is_archived` to your table to indicate whether the record
should be skipped over by default or not:

```sql
alter table my_table add column is_archived boolean not null default false;
```

Then append this plugin to your PostGraphile options.

### Usage - CLI

When using this via the CLI, the database column must be named `is_archived`.

```
postgraphile --append-plugins @graphile-contrib/pg-omit-archived -c postgres:///my_db
```

### Usage - Library

You can modify the archived column name when using PostGraphile as a library, e.g.:

```js
const express = require("express");
const { postgraphile } = require("postgraphile");
const PgOmitArchived = require("@graphile-contrib/pg-omit-archived");

const app = express();

app.use(
  postgraphile(process.env.DATABASE_URL, "app_public", {
    /* 👇👇👇 */
    appendPlugins: [PgOmitArchived],
    graphileBuildOptions: {
      pgArchivedColumnName: "isArchived",
    },
    /* ☝️☝️☝️ */
  })
);

app.listen(process.env.PORT || 3000);
```

## Behaviour

Root level query fields will omit archived records by default.

Plural relation fields on an object will by default be set to INHERIT, which
means that if the parent record is archived then all child records will be
included; otherwise (if the parent record is NOT archived) only the
non-archived child records will be available.

Singular relations and lookups ignore the `is_archived` column - it's assumed
that if you know the exact ID then you're deliberately opting to view the
archived record.

This plugin **does not** prevent people from seeing archived records, it merely
prevents them being included _by default_ by various collections so you must
opt to see archived content.

## Assumptions

It's assumed that if a record is archived then all of its children should also
be archived. We don't actually care if this is the case or not, and will work
regardless, but it's an assumption that we have.

## Thanks

🙏 This plugin was sponsored by https://sprout.io
