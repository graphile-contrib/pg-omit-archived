// @ts-check
/**
 * This plugin was sponsored by Sprout LLC. 🙏
 *
 * https://sprout.io
 */

const { makePluginByCombiningPlugins } = require("graphile-utils");

/**
 * Build utils
 *
 * @param {Build} build - Graphile Build object
 * @param {string} keyword - 'archived' or 'deleted' or similar
 * @param {PgClass} table - The table we're building a query against
 * @param {PgClass | null | void} parentTable - The table of the `parentQueryBuilder`, if any
 * @param {boolean | null | void} allowInherit - Should we allow inheritance if it seems possible?
 */
const makeUtils = (build, keyword, table, parentTable, allowInherit) => {
  const Keyword = keyword[0].toUpperCase() + keyword.slice(1);
  const {
    pgSql: sql,
    getTypeByName,
    pgIntrospectionResultsByKind: introspectionResultsByKind,
    options: {
      [`pg${Keyword}ColumnName`]: columnNameToCheck = `is_${keyword}`,
    },
  } = build;
  const OptionType = getTypeByName(`Include${Keyword}Option`);

  const getRelevantColumn = tableToCheck =>
    tableToCheck
      ? introspectionResultsByKind.attribute.find(
          attr =>
            attr.classId === tableToCheck.id && attr.name === columnNameToCheck,
        )
      : null;
  const relevantColumn = getRelevantColumn(table);
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

  const visibleFragment = columnDetails.isBoolean
    ? sql.fragment`false`
    : sql.fragment`null`;

  const parentVisibleFragment =
    parentColumnDetails && parentColumnDetails.isBoolean
      ? sql.fragment`false`
      : sql.fragment`null`;
  function addWhereClause(queryBuilder, fieldArgs) {
    const { [`include${Keyword}`]: relevantSetting } = fieldArgs;
    if (
      capableOfInherit &&
      relevantSetting === "INHERIT" &&
      queryBuilder.parentQueryBuilder
    ) {
      const sqlParentTableAlias = queryBuilder.parentQueryBuilder.getTableAlias();
      queryBuilder.where(
        sql.fragment`(${sqlParentTableAlias}.${sql.identifier(
          parentColumnDetails.name,
        )} is not ${parentVisibleFragment} or ${queryBuilder.getTableAlias()}.${sql.identifier(
          columnDetails.name,
        )} is ${visibleFragment})`,
      );
    } else if (
      relevantSetting === "NO" ||
      // INHERIT is equivalent to NO if there's no valid parent
      relevantSetting === "INHERIT"
    ) {
      queryBuilder.where(
        sql.fragment`${queryBuilder.getTableAlias()}.${sql.identifier(
          columnDetails.name,
        )} is ${visibleFragment}`,
      );
    } else if (relevantSetting === "EXCLUSIVELY") {
      queryBuilder.where(
        sql.fragment`${queryBuilder.getTableAlias()}.${sql.identifier(
          columnDetails.name,
        )} is not ${visibleFragment}`,
      );
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
 * 'eradicated', though 'scheduledForDeletion' is probably okay, as is
 * 'template' - have a read through where it's used and judge for yourself
 */
const generator = (keyword = "archived") => {
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
  const AddToEnumPlugin = builder => {
    /* Had to move this to the build phase so that other plugins can use it */
    builder.hook("build", build => {
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

  const PgOmitInnerPlugin = builder => {
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
            includeArchived,
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
          !!args[`include${keyword}`] ||
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
        addArgDataGenerator(function connectionCondition(fieldArgs) {
          return {
            pgQuery: queryBuilder => {
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

const Plugin = generator();
module.exports = Plugin;
module.exports.custom = generator;
module.exports.makeUtils = makeUtils;
