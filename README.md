# @graphile-contrib/pg-omit-archived

This Graphile Engine plugin can be used to give your schema support for
"soft-deletes" - where you set an `is_archived` or `is_deleted` column to true
and expect the record to be omitted by default (but it's still available to be
recovered should you need to). It's also useful for hiding certain other classes
of records by default, but allowing them to be shown by passing a parameter; for
example you could hide drafts via a `published_at` column and require an
explicit `includeDrafts: YES` setting to show them.

It's possible (and common) to use this plugin multiple times (for different
column names/meanings) - when you do so you must use a different keyword for
each plugin invocation.

## Installing

This requires `postgraphile@^4.5.5`.

```
yarn add postgraphile @graphile-contrib/pg-omit-archived
```

(Or replace `yarn add` with `npm install --save` if you use npm.)

## Usage

Add a column to your table to indicate whether the record should be skipped over
by default or not, and then append this plugin to your PostGraphile options. CLI
usage is more restrictive than library usage, so if you want more powerful
integration we recommend you use PostGraphile in library (middleware) mode.

### Usage - CLI

If you're using the CLI then you must use a boolean `is_archived` column:

```sql
alter table my_table add column is_archived boolean not null default false;
```

Then append this plugin with `--append-plugins`:

```
postgraphile --append-plugins @graphile-contrib/pg-omit-archived -c postgres:///my_db
```

### Usage - Library

**IMPORTANT**: if a nullable or boolean column is not suitable for your needs,
please see the section on expressions below.

If you're using PostGraphile in library (middleware) mode then you have more
configuration options and you can specify a column that's _either_ boolean _or_
nullable. A nullable timestamptz column is a popular choice:

```sql
alter table my_table add column archived_at timestamptz;
```

If you're not using a boolean `is_archived` column then you must specify the
column name, which you can do via the `pgArchivedColumnName` option.

You can also tell the plugin to invert the include/exclude logic with the
`pgArchivedColumnImpliesVisible` option (e.g. if you're using `is_published`
you'd set `pgArchivedColumnImpliesVisible: true` rather than the default
`pgArchivedColumnImpliesVisible: false` which would be appropriate for
`is_draft`). More information on this below.

Another option is to have the plugin apply to related records with the
`pgArchivedRelations: true` option - more on this below.

Example:

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
      pgArchivedRelations: false,
    },
    /* ☝️☝️☝️ */
  }),
);

app.listen(process.env.PORT || 3000);
```

You can also use the plugin multiple times for different columns using the
`custom(keyword)` plugin factory. When you do this you supply a `keyword` and
all of the options are based on this keyword so you can configure each plugin
individually (we also look for the column `is_${keyword}`). For example:

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
      /* -------- Options for 'archived' -------- */
      // Boolean column -> checked as "IS NOT TRUE":
      pgArchivedColumnName: "is_archived",
      // When true, hide; when false, visible:
      pgArchivedColumnImpliesVisible: false,
      // Only add includeArchived to tables with is_archived column:
      pgArchivedRelations: false,

      /* -------- Options for 'deleted' -------- */
      // Non-boolean column -> checked as "IS NULL":
      pgDeletedColumnName: "deleted_at",
      // Also add includeDeleted to tables which belong to a table with
      // deleted_at column:
      pgArchivedRelations: true,

      /* -------- Options for 'template' -------- */
      pgTemplateColumnName: "is_template",

      /* -------- Options for 'draft' -------- */
      // Column name doesn't have to match keyword name:
      pgDraftColumnName: "is_published",
      // When true -> published -> visible; when false -> unpublished -> hidden
      pgDraftColumnImpliesVisible: true,
    },
    /* ☝️☝️☝️ */
  }),
);

app.listen(process.env.PORT || 3000);
```

### Usage - advanced options

By default we'll look for a column named after your keyword (e.g. if you use the
'deleted' keyword, we'll look for an `is_deleted` column). You may override the
column adding the `pg<Keyword>ColumnName: 'my_column_name_here'` (e.g.
`pgDeletedColumnName: 'deleted_at'`) setting to `graphileBuildOptions`, where
`<Keyword>` is your keyword with the first character uppercased (see above for
examples).

This plugin was built expecting to hide things when `true` (boolean) or non-null
(e.g. nullable timestamp) - this works well for things like `is_archived`,
`deleted_at`, and `is_template`. However sometimes you want this inverse of this
behaviour; e.g. if your column is `published_at` you'd want it visible when
non-null and hidden when null. To invert the behaviour, add the
`pg<Keyword>ColumnImpliesVisible: true` (e.g.
`pgDraftColumnImpliesVisible: true`) setting to `graphileBuildOptions`, where
`<Keyword>` is your keyword with the first character uppercased (see above for
examples).

By default this plugin only adds the `include<Keyword>` (e.g. `includeArchived`)
argument to collections for tables that have the relevant (e.g. `is_archived`)
column. Sometimes however you want to expand this behaviour to tables that
"belong to" this table. To achieve this, use the `pg<Keyword>Relations: true`
(e.g. `pgArchivedRelations: true`) option (or for more granular control use the
`@<keyword>Relation` (e.g. `@archivedRelation`) smart comment/smart tag on the
relevant foreign key constraint), and we'll add an argument like
`includeWhen<Relation><Keyword>` (e.g. `includeWhenParentByParentIdArchived`).
You should use this sparingly as it's not implemented particularly efficiently,
and it also will make your schema somewhat larger/more complex.

### Usage - advanced expressions

If a boolean or nullable column is not sufficient for your needs then since
v3.0.0 you can use an expression instead. This allows you to write queries such
as `my_table.status = 'archived'` or
`my_table.archived_at is not null or my_table.deleted_at is not null or my_table.published_at is null`
or even `my_computed_column(my_table) is true` (but be careful with that one;
performance would likely be poor!).

To use this, instead of setting `pgArchivedColumnName` you can specify both:

- `pgArchivedExpression` (or `pg<Keyword>Expression`): a function that accepts
  `sql` and `tableAlias` and returns a
  [pg-sql2 fragment](https://github.com/graphile/graphile-engine/tree/9d6c29e3505844ca64020fb6850093a7678a0fa4/packages/pg-sql2#sqlquery)
  that should resolve to a boolean indicating that the row should be omitted
- `pgArchivedTables` (or `pg<Keyword>Tables`): an array of tables that this
  expression applies to (since we can't determine this automatically)

```ts
app.use(
  postgraphile(process.env.DATABASE_URL, "app_public", {
    appendPlugins: [customPgOmitArchived("archived")],
    graphileBuildOptions: {
      /* 👇👇👇 */
      // What tables does the expression apply to?
      pgArchivedTables: ["my_schema.my_table"],

      // SQL expression that returns true if the row should be omitted
      pgArchivedExpression: (sql, tableAlias) =>
        sql.fragment`${tableAlias}.status = 'archived'`,
      /* ☝️☝️☝️ */
    },
  }),
);
```

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
