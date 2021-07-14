/**
 * This plugin was sponsored by Sprout LLC. 🙏
 *
 * https://sprout.io
 */

import { makePluginByCombiningPlugins } from "graphile-utils";
import type { Build, Plugin as GraphileEnginePlugin } from "postgraphile";
import type {
  PgAttribute,
  PgClass,
  PgIntrospectionResultsByKind,
  QueryBuilder,
  SQL,
} from "graphile-build-pg";

/**
 * Build utils
 *
 * @param build - Graphile Build object
 * @param keyword - 'archived' or 'deleted' or similar
 * @param table - The table we're building a query against
 * @param parentTable - The table of the `parentQueryBuilder`, if any
 * @param allowInherit - Should we allow inheritance if it seems possible?
 */
const makeUtils = (
  build: Build,
  keyword: string,
  table: PgClass,
  parentTable: PgClass,
  allowInherit?: boolean,
) => {
  const Keyword = keyword[0].toUpperCase() + keyword.slice(1);
  const {
    getTypeByName,
    options: {
      [`pg${Keyword}ColumnName`]: columnNameToCheck = `is_${keyword}`,
      // If true inverts the omitting logic (e.g. true for `is_published` or
      // `published_at`; false for `is_archived` or `archived_at`).
      [`pg${Keyword}ColumnImpliesVisible`]: invert = false,
      [`pg${Keyword}Relations`]: applyToRelations = false,
    },
  } = build;
  const sql = build.pgSql as typeof import("pg-sql2");
  const introspectionResultsByKind = build.pgIntrospectionResultsByKind as PgIntrospectionResultsByKind;
  const OptionType = getTypeByName(`Include${Keyword}Option`);

  const getRelevantColumn = (tableToCheck: PgClass) =>
    tableToCheck
      ? introspectionResultsByKind.attribute.find(
          (attr) =>
            attr.classId === tableToCheck.id && attr.name === columnNameToCheck,
        )
      : null;

  // It doesn't apply to us directly; do we have a relation that's relevant?
  const relevantRelations = applyToRelations
    ? introspectionResultsByKind.constraint.filter(
        (c) =>
          c.type === "f" &&
          c.classId === table.id &&
          c.foreignClass &&
          getRelevantColumn(c.foreignClass),
      )
    : [];
  // Pick the first one (order by constraint name)
  const relevantRelation = relevantRelations.sort((a, z) =>
    a.name.localeCompare(z.name),
  )[0];

  const relevantColumn =
    getRelevantColumn(table) ||
    (relevantRelation && relevantRelation.foreignClass
      ? getRelevantColumn(relevantRelation.foreignClass)
      : null);

  if (!relevantColumn) {
    return null;
  }

  const parentTableRelevantColumn = getRelevantColumn(parentTable);
  const capableOfInherit = allowInherit && !!parentTableRelevantColumn;
  const pgRelevantColumnIsBoolean = relevantColumn.type.category === "B";
  const pgParentRelevantColumnIsBoolean =
    parentTableRelevantColumn &&
    parentTableRelevantColumn.type.category === "B";

  const columnDetails = {
    isBoolean: pgRelevantColumnIsBoolean,
    name: relevantColumn.name,
  };
  const parentColumnDetails = parentTableRelevantColumn
    ? {
        isBoolean: pgParentRelevantColumnIsBoolean,
        canInherit: capableOfInherit,
        name: parentTableRelevantColumn.name,
      }
    : null;

  const booleanVisibleFragment = invert
    ? sql.fragment`true`
    : sql.fragment`false`;

  const booleanInvisibleFragment = invert
    ? sql.fragment`not true`
    : sql.fragment`not false`; // Keep in mind booleans are trinary in Postgres: true, false, null

  const nullableVisibleFragment = invert
    ? sql.fragment`not null`
    : sql.fragment`null`;

  const nullableInvisibleFragment = invert
    ? sql.fragment`null`
    : sql.fragment`not null`;

  const [visibleFragment, invisibleFragment] = columnDetails.isBoolean
    ? [booleanVisibleFragment, booleanInvisibleFragment]
    : [nullableVisibleFragment, nullableInvisibleFragment];

  const [_parentVisibleFragment, parentInvisibleFragment] =
    parentColumnDetails && parentColumnDetails.isBoolean
      ? [booleanVisibleFragment, booleanInvisibleFragment]
      : [nullableVisibleFragment, nullableInvisibleFragment];

  function addWhereClause(queryBuilder: QueryBuilder, fieldArgs: any) {
    // TypeScript hack
    if (!relevantColumn) {
      return;
    }
    const { [`include${Keyword}`]: relevantSetting } = fieldArgs;
    let fragment: SQL | null = null;

    const myAlias =
      relevantColumn.class !== table
        ? sql.identifier(Symbol("me"))
        : queryBuilder.getTableAlias();
    if (
      capableOfInherit &&
      relevantSetting === "INHERIT" &&
      queryBuilder.parentQueryBuilder &&
      parentColumnDetails
    ) {
      const sqlParentTableAlias = queryBuilder.parentQueryBuilder.getTableAlias();
      fragment = sql.fragment`(${sqlParentTableAlias}.${sql.identifier(
        parentColumnDetails.name,
      )} is ${parentInvisibleFragment} or ${myAlias}.${sql.identifier(
        columnDetails.name,
      )} is ${visibleFragment})`;
    } else if (
      relevantSetting === "NO" ||
      // INHERIT is equivalent to NO if there's no valid parent
      relevantSetting === "INHERIT"
    ) {
      fragment = sql.fragment`${myAlias}.${sql.identifier(
        columnDetails.name,
      )} is ${visibleFragment}`;
    } else if (relevantSetting === "EXCLUSIVELY") {
      fragment = sql.fragment`${myAlias}.${sql.identifier(
        columnDetails.name,
      )} is ${invisibleFragment}`;
    }
    if (fragment) {
      if (relevantRelation && relevantColumn.class !== table) {
        const localAlias = queryBuilder.getTableAlias();
        const relationConditions = relevantRelation.keyAttributes.map(
          (attr, i) => {
            const otherAttr = relevantRelation.foreignKeyAttributes[i];
            return sql.fragment`${localAlias}.${sql.identifier(
              attr.name,
            )} = ${myAlias}.${sql.identifier(otherAttr.name)}`;
          },
        );
        queryBuilder.where(
          sql.fragment`(select ${fragment} from ${sql.identifier(
            relevantColumn.class.namespaceName,
            relevantColumn.class.name,
          )} as ${myAlias} where (${sql.join(
            relationConditions,
            ") and (",
          )})) is true`,
        );
      } else {
        queryBuilder.where(fragment);
      }
    }
  }
  return {
    OptionType,
    addWhereClause,
    capableOfInherit,
  };
};

/*
 * keyword should probably end in 'ed', e.g. 'archived', 'deleted',
 * 'eradicated', 'unpublished', though 'scheduledForDeletion' is probably okay,
 * as is 'template' or 'draft' - have a read through where it's used and judge
 * for yourself
 */
const generator = (keyword = "archived"): GraphileEnginePlugin => {
  const Keyword = keyword[0].toUpperCase() + keyword.slice(1);

  /*
  const AddToEnumPlugin = makeExtendSchemaPlugin(() => ({
    typeDefs: gql_`
      """
      Indicates whether ${keyword} items should be included in the results or not.
      """
      enum Include${Keyword}Option @scope(isInclude${Keyword}OptionEnum: true) {
        """
        Exclude ${keyword} items.
        """
        NO

        """
        Include ${keyword} items.
        """
        YES

        """
        Only include ${keyword} items (i.e. exclude non-${keyword} items).
        """
        EXCLUSIVELY

        """
        If there is a parent GraphQL record and it is ${keyword} then this is equivalent to YES, in all other cases this is equivalent to NO.
        """
        INHERIT
      }
    `,
    resolvers: {
      [`Include${Keyword}Option`]: {
        NO: "NO",
        YES: "YES",
        EXCLUSIVELY: "EXCLUSIVELY",
        INHERIT: "INHERIT",
      },
    },
  }));
  */
  const AddToEnumPlugin: GraphileEnginePlugin = (builder) => {
    /* Had to move this to the build phase so that other plugins can use it */
    builder.hook("build", (build) => {
      const {
        graphql: { GraphQLEnumType },
      } = build;
      build.newWithHooks(
        GraphQLEnumType,
        {
          name: `Include${Keyword}Option`,
          description: `Indicates whether ${keyword} items should be included in the results or not.`,
          values: {
            NO: {
              value: "NO",
              description: `Exclude ${keyword} items.`,
            },
            YES: {
              description: `Include ${keyword} items.`,
              value: "YES",
            },
            EXCLUSIVELY: {
              description: `Only include ${keyword} items (i.e. exclude non-${keyword} items).`,
              value: "EXCLUSIVELY",
            },
            INHERIT: {
              description: `If there is a parent GraphQL record and it is ${keyword} then this is equivalent to YES, in all other cases this is equivalent to NO.`,
              value: "INHERIT",
            },
          },
        },
        {
          [`isInclude${Keyword}OptionEnum`]: true,
        },
      );
      return build;
    });
  };

  const PgOmitInnerPlugin: GraphileEnginePlugin = (builder) => {
    builder.hook(
      "GraphQLObjectType:fields:field:args",
      (args, build, context) => {
        const { extend } = build;
        const {
          scope: {
            isPgFieldConnection,
            isPgFieldSimpleCollection,
            isPgBackwardRelationField,
            pgFieldIntrospection: table,
            pgIntrospection: parentTable,
            [`include${Keyword}`]: includeArchived,
          },
          addArgDataGenerator,
          Self,
          field,
        } = context;
        if (
          !(isPgFieldConnection || isPgFieldSimpleCollection) ||
          !table ||
          table.kind !== "class" ||
          !table.namespace ||
          !!args[`include${Keyword}`] ||
          includeArchived
        ) {
          return args;
        }
        const allowInherit = isPgBackwardRelationField;
        const utils = makeUtils(
          build,
          keyword,
          table,
          parentTable,
          allowInherit,
        );
        if (!utils) {
          return args;
        }
        const { addWhereClause, OptionType, capableOfInherit } = utils;
        addArgDataGenerator(function connectionCondition(fieldArgs: any) {
          return {
            pgQuery: (queryBuilder: QueryBuilder) => {
              addWhereClause(queryBuilder, fieldArgs);
            },
          };
        });

        return extend(
          args,
          {
            [`include${Keyword}`]: {
              description: `Indicates whether ${keyword} items should be included in the results or not.`,
              type: OptionType,
              defaultValue: capableOfInherit ? "INHERIT" : "NO",
            },
          },
          `Adding include${Keyword} argument to connection field '${field.name}' of '${Self.name}'`,
        );
      },
    );
  };

  const Plugin = makePluginByCombiningPlugins(
    AddToEnumPlugin,
    PgOmitInnerPlugin,
  );
  Plugin.displayName = `PgOmit${Keyword}Plugin`;
  return Plugin;
};

const Plugin = Object.assign(generator(), {
  custom: generator,
  makeUtils,
});
export default Plugin;
export { generator as custom, makeUtils };
