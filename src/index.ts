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
  PgConstraint,
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
  relevantRelation?: PgConstraint | null,
) => {
  const Keyword = keyword[0].toUpperCase() + keyword.slice(1);
  const {
    inflection,
    getTypeByName,
    options: {
      [`pg${Keyword}ColumnName`]: columnNameToCheck = `is_${keyword}`,
      // If true inverts the omitting logic (e.g. true for `is_published` or
      // `published_at`; false for `is_archived` or `archived_at`).
      [`pg${Keyword}ColumnImpliesVisible`]: invert = false,
      [`pg${Keyword}Relations`]: applyToRelations = false,
      [`pg${Keyword}Expression`]: expression = null,
      [`pg${Keyword}Tables`]: rawTables = null,
    },
  } = build;
  const sql = build.pgSql as typeof import("pg-sql2");
  const introspectionResultsByKind = build.pgIntrospectionResultsByKind as PgIntrospectionResultsByKind;
  const OptionType = getTypeByName(`Include${Keyword}Option`);

  if (expression && build.options[`pg${Keyword}ColumnName`]) {
    throw new Error(
      `'pg${Keyword}Expression' cannot be combined with 'pg${Keyword}ColumnName'`,
    );
  }
  if (expression && build.options[`pg${Keyword}ColumnImpliesVisible`]) {
    throw new Error(
      `'pg${Keyword}Expression' cannot be combined with 'pg${Keyword}ColumnImpliesVisible'`,
    );
  }
  if (expression && !build.options[`pg${Keyword}Tables`]) {
    throw new Error(
      `'pg${Keyword}Expression' requires 'pg${Keyword}Tables' to be set to a list of the tables to which this expression can apply.`,
    );
  }

  const tables = rawTables
    ? (rawTables as string[]).map((t) => {
        const [schemaOrTable, tableOnly, ...rest] = t.split(".");
        if (rest.length) {
          throw new Error("Could not parse ${t} into schema + table.");
        }
        return tableOnly
          ? [schemaOrTable, tableOnly]
          : ["public", schemaOrTable];
      })
    : null;

  const getRelevantColumn = (tableToCheck: PgClass) =>
    tableToCheck
      ? introspectionResultsByKind.attribute.find(
          (attr) =>
            attr.classId === tableToCheck.id && attr.name === columnNameToCheck,
        )
      : null;

  const _tableIsAllowed = (table: PgClass | null | undefined) =>
    table != null &&
    (tables == null ||
      tables.some((t) => table.namespaceName === t[0] && table.name === t[1]));

  const appliesToTable = (table: PgClass) =>
    _tableIsAllowed(table) && (expression || getRelevantColumn(table));

  if (relevantRelation) {
    if (!applyToRelations && !relevantRelation.tags[`${keyword}Relation`]) {
      return null;
    }
    if (
      !relevantRelation.foreignClass ||
      relevantRelation.classId !== table.id ||
      !appliesToTable(relevantRelation.foreignClass)
    ) {
      return null;
    }
  }

  const relevantClass = relevantRelation
    ? (relevantRelation.foreignClass as PgClass | never)
    : table;

  if (!relevantClass) {
    return null;
  }

  const relevantColumn = getRelevantColumn(relevantClass);

  const argumentName = inflection[`include${Keyword}Argument`](
    table,
    relevantRelation,
  );

  const parentTableRelevantColumn = getRelevantColumn(parentTable);
  const capableOfInherit = allowInherit && appliesToTable(parentTable);
  const pgRelevantColumnIsBoolean = relevantColumn?.type.category === "B";
  const pgParentRelevantColumnIsBoolean =
    parentTableRelevantColumn &&
    parentTableRelevantColumn.type.category === "B";

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

  const rawLocalDetails = expression
    ? appliesToTable(relevantClass)
      ? {
          expression: (_sql: typeof sql, tableAlias: SQL) =>
            sql.fragment`(${expression(sql, tableAlias)})`,
          visibleFragment: booleanVisibleFragment,
          invisibleFragment: booleanInvisibleFragment,
        }
      : null
    : relevantColumn
    ? {
        expression: (_sql: typeof sql, tableAlias: SQL) =>
          sql.fragment`${tableAlias}.${sql.identifier(relevantColumn.name)}`,
        visibleFragment: pgRelevantColumnIsBoolean
          ? booleanVisibleFragment
          : nullableVisibleFragment,
        invisibleFragment: pgRelevantColumnIsBoolean
          ? booleanInvisibleFragment
          : nullableInvisibleFragment,
      }
    : null;

  if (!rawLocalDetails) {
    return null;
  }
  const localDetails = rawLocalDetails;

  const parentDetails = appliesToTable(parentTable)
    ? expression
      ? {
          expression: (_sql: typeof sql, tableAlias: SQL) =>
            sql.fragment`(${expression(sql, tableAlias)})`,
          visibleFragment: booleanVisibleFragment,
          invisibleFragment: booleanInvisibleFragment,
        }
      : parentTableRelevantColumn
      ? {
          expression: (_sql: typeof sql, tableAlias: SQL) =>
            sql.fragment`${tableAlias}.${sql.identifier(
              parentTableRelevantColumn.name,
            )}`,
          visibleFragment: pgParentRelevantColumnIsBoolean
            ? booleanVisibleFragment
            : nullableVisibleFragment,
          invisibleFragment: pgParentRelevantColumnIsBoolean
            ? booleanInvisibleFragment
            : nullableInvisibleFragment,
        }
      : null
    : null;

  function addWhereClause(queryBuilder: QueryBuilder, fieldArgs: any) {
    const { [argumentName]: relevantSetting } = fieldArgs;
    let fragment: SQL | null = null;

    const myAlias =
      relevantClass !== table
        ? sql.identifier(Symbol("me"))
        : queryBuilder.getTableAlias();
    if (
      relevantRelation &&
      relevantClass !== table &&
      relevantRelation.foreignClass === parentTable &&
      capableOfInherit &&
      queryBuilder.parentQueryBuilder &&
      parentDetails &&
      ["INHERIT", "YES"].includes(relevantSetting)
    ) {
      // In this case the work is already done by the parent record and it
      // cannot be overridden by this level (since we don't have the relevant
      // field and we just import ours from the parent); no need to add
      // any extra WHERE clauses.
      return;
    }
    if (
      capableOfInherit &&
      relevantSetting === "INHERIT" &&
      queryBuilder.parentQueryBuilder &&
      parentDetails
    ) {
      const sqlParentTableAlias = queryBuilder.parentQueryBuilder.getTableAlias();
      fragment = sql.fragment`(${parentDetails.expression(
        sql,
        sqlParentTableAlias,
      )} is ${parentDetails.invisibleFragment} or ${localDetails.expression(
        sql,
        myAlias,
      )} is ${localDetails.visibleFragment})`;
    } else if (
      relevantSetting === "NO" ||
      // INHERIT is equivalent to NO if there's no valid parent
      relevantSetting === "INHERIT"
    ) {
      fragment = sql.fragment`${localDetails.expression(sql, myAlias)} is ${
        localDetails.visibleFragment
      }`;
    } else if (relevantSetting === "EXCLUSIVELY") {
      fragment = sql.fragment`${localDetails.expression(sql, myAlias)} is ${
        localDetails.invisibleFragment
      }`;
    }
    if (fragment) {
      if (relevantRelation && relevantClass !== table) {
        const localAlias = queryBuilder.getTableAlias();
        const relationConditions = relevantRelation.keyAttributes.map(
          (attr, i) => {
            const otherAttr = relevantRelation.foreignKeyAttributes[i];
            return sql.fragment`${localAlias}.${sql.identifier(
              attr.name,
            )} = ${myAlias}.${sql.identifier(otherAttr.name)}`;
          },
        );
        const subquery = sql.fragment`exists (select 1 from ${sql.identifier(
          relevantClass.namespaceName,
          relevantClass.name,
        )} as ${myAlias} where (${sql.join(
          relationConditions,
          ") and (",
        )}) and (${fragment}))`;
        queryBuilder.where(subquery);
      } else {
        queryBuilder.where(fragment);
      }
    }
  }
  return {
    OptionType,
    addWhereClause,
    capableOfInherit,
    argumentName,
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

  const AddInflectorsPlugin: GraphileEnginePlugin = (builder) => {
    builder.hook("inflection", (inflection, build) => {
      return build.extend(
        inflection,
        {
          [`include${Keyword}Argument`](
            table: PgClass,
            relation: PgConstraint,
          ) {
            const relationPart = relation
              ? inflection.singleRelationByKeys(
                  relation.keyAttributes,
                  relation.foreignClass,
                  table,
                  relation,
                )
              : null;
            const argumentName = relationPart
              ? `includeWhen${inflection.upperCamelCase(
                  relationPart,
                )}${Keyword}`
              : `include${Keyword}`;
            return argumentName;
          },
        },
        `Adding inflectors for '${keyword}' pg-omit-archived`,
      );
    });
  };

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
            pgFieldIntrospection,
            pgIntrospection: parentTable,
            [`include${Keyword}`]: includeArchived,
          },
          addArgDataGenerator,
          Self,
          field,
        } = context;
        const defaultValue = build.options[`pg${Keyword}Default`] || "NO";
        const table: PgClass = pgFieldIntrospection;
        if (
          !(isPgFieldConnection || isPgFieldSimpleCollection) ||
          !table ||
          table.kind !== "class" ||
          !table.namespace ||
          includeArchived
        ) {
          return args;
        }
        const allowInherit = isPgBackwardRelationField;
        const selfAndConstraints = [
          null,
          ...table.constraints
            .filter((c) => c.type === "f")
            .sort((a, z) => a.name.localeCompare(z.name)),
        ];
        const allUtils = selfAndConstraints.map((relation) =>
          makeUtils(build, keyword, table, parentTable, allowInherit, relation),
        );
        if (!allUtils) {
          return args;
        }
        return allUtils.reduce((args, utils) => {
          if (!utils) {
            return args;
          }
          const {
            addWhereClause,
            OptionType,
            capableOfInherit,
            argumentName,
          } = utils;
          if (!!args[argumentName]) {
            return args;
          }
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
              [argumentName]: {
                description: `Indicates whether ${keyword} items should be included in the results or not.`,
                type: OptionType,
                defaultValue: capableOfInherit ? "INHERIT" : defaultValue,
              },
            },
            `Adding ${argumentName} argument to connection field '${field.name}' of '${Self.name}'`,
          );
        }, args);
      },
    );
  };

  const Plugin = makePluginByCombiningPlugins(
    AddInflectorsPlugin,
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
