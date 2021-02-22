# @graphile-contrib/pg-omit-archived

This Graphile Engine plugin can be used to give your schema support for
"soft-deletes" - where you set an `is_archived` or `is_deleted` column to true
and expect the record to be omitted by default (but it's still available to be
recovered should you need to). It's also useful for hiding certain other classes
of records by default, but allowing them to be shown by passing a parameter; for
example you could hide drafts via a `published_at` column and require an
explicit `includeDrafts: YES` setting to show them.

It's possible (and common) to use this plugin multiple times (for different
column names/meanings).

## Installing

This requires `postgraphile@^4.5.5`.

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

You can modify the archived column name when using PostGraphile as a library,
e.g.:

```js
const express = require("express");
const { postgraphile } = require("postgraphile");
const {
  default: PgOmitArchived,
} = require("@graphile-contrib/pg-omit-archived");

const app = express();

app.use(
  postgraphile(process.env.DATABASE_URL, "app_public", {
    /* 👇👇👇 */
    appendPlugins: [PgOmitArchived],
    graphileBuildOptions: {
      pgArchivedColumnName: "is_archived",
      pgArchivedColumnImpliesVisible: false,
    },
    /* ☝️☝️☝️ */
  }),
);

app.listen(process.env.PORT || 3000);
```

You can also use the plugin multiple times for different columns, for example:

```js
const express = require("express");
const { postgraphile } = require("postgraphile");
const {
  custom: customPgOmitArchived,
} = require("@graphile-contrib/pg-omit-archived");

const app = express();

app.use(
  postgraphile(process.env.DATABASE_URL, "app_public", {
    /* 👇👇👇 */
    appendPlugins: [
      customPgOmitArchived("archived"),
      customPgOmitArchived("deleted"),
      customPgOmitArchived("template"),
      customPgOmitArchived("draft"), // e.g. draft vs published
    ],
    graphileBuildOptions: {
      // Options for 'archived':
      pgArchivedColumnName: "is_archived", // boolean column -> checked as "IS NOT TRUE"
      pgArchivedColumnImpliesVisible: false, // when true, hide; when false, visible

      // Options for 'deleted':
      pgDeletedColumnName: "deleted_at", // non-boolean column -> checked as "IS NULL"

      // Options for 'template':
      pgTemplateColumnName: "is_template",

      // Options for 'draft':
      pgDraftColumnName: "is_published", // Column name doesn't have to match keyword name
      pgDraftColumnImpliesVisible: true, // When true -> published -> visible; when false -> unpublished -> hiddel
    },
    /* ☝️☝️☝️ */
  }),
);

app.listen(process.env.PORT || 3000);
```

### Usage - advanced options

By default we'll look for a column named after your keyword (e.g. if you use the
'deleted' keyword, we'll look for an `is_deleted` column). You may override the
column adding the `pg<Keyword>ColumnName: 'my_column_name_here'` setting to
`graphileBuildOptions`, where `<Keyword>` is your keyword with the first
character uppercased (see above for examples).

This plugin was built expecting to hide things when `true` (boolean) or non-null
(e.g. nullable timestamp) - this works well for things like `is_archived`,
`deleted_at`, and `is_template`. However sometimes you want this inverse of this
behaviour; e.g. if your column is `published_at` you'd want it visible when
non-null and hidden when null. To invert the behaviour, add the
`pg<Keyword>ColumnImpliesVisible: true` setting to `graphileBuildOptions`, where
`<Keyword>` is your keyword with the first character uppercased (see above for
examples).

## Behaviour

Root level query fields will omit archived records by default.

Plural relation fields on an object will by default be set to `INHERIT`, which
means that if the parent record is archived then all child records will be
included; otherwise (if the parent record is _NOT_ archived) only the
non-archived child records will be available.

Singular relations and lookups ignore the `is_archived` column - it's assumed
that if you know the exact ID then you're deliberately opting to view the
archived record.

This plugin **does not** prevent people from seeing archived records, it merely
prevents them being included _by default_ by various collections so you must opt
to see the excluded content.

## Assumptions

It's assumed that if a record is archived then all of its children will also be
archived. We don't actually care if this is the case or not, and will work
regardless, but it's an assumption that we have. It's up to you to enforce this
if it makes sense to do so ─ database triggers are a good solution to this.

## Thanks

🙏 This plugin was sponsored by https://sprout.io and is used in production.
