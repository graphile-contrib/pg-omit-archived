/**
 * This plugin was sponsored by Sprout LLC. 🙏
 *
 * https://sprout.io
 */

const {
  makeExtendSchemaPlugin,
  makePluginByCombiningPlugins,
  gql,
} = require("graphile-utils");

const AddIncludeArchivedOptionEnumPlugin = makeExtendSchemaPlugin(() => ({
  typeDefs: gql`
    """
    Indicates whether archived items should be included in the results or not.
    """
    enum IncludeArchivedOption @scope(isIncludeArchivedOptionEnum: true) {
      """
      Exclude archived items.
      """
      NO
      """
      Include archived items.
      """
      YES
      """
      Only include archived items (i.e. exclude non-archived items).
      """
      EXCLUSIVELY
      """
      Only appropriate when used on a GraphQL relation. If the parent of the relation is archived then equivalent to YES, in all other cases equivalent to NO.
      """
      INHERIT
    }
  `,
  resolvers: {
    IncludeArchivedOption: {
      NO: "NO",
      YES: "YES",
      EXCLUSIVELY: "EXCLUSIVELY",
      INHERIT: "INHERIT",
    },
  },
}));

const PgOmitArchivedInnerPlugin = (
  builder,
  { pgArchivedColumnName = "is_archived" }
) => {
  builder.hook(
    "GraphQLObjectType:fields:field:args",
    (args, build, context) => {
      const {
        pgSql: sql,
        extend,
        pgIntrospectionResultsByKind: introspectionResultsByKind,
        getTypeByName,
      } = build;
      const {
        scope: {
          isPgFieldConnection,
          isPgBackwardRelationField,
          pgFieldIntrospection: table,
          pgIntrospection: parentTable,
        },
        addArgDataGenerator,
        Self,
        field,
      } = context;
      if (
        !isPgFieldConnection ||
        !table ||
        table.kind !== "class" ||
        !table.namespace ||
        !!args.includeArchived
      ) {
        return args;
      }
      const getArchivedColumn = tableToCheck =>
        tableToCheck
          ? introspectionResultsByKind.attribute.find(
              attr =>
                attr.classId === tableToCheck.id &&
                attr.name === pgArchivedColumnName
            )
          : null;
      const archivedColumn = getArchivedColumn(table);
      if (!archivedColumn) {
        return args;
      }
      const IncludeArchivedOption = getTypeByName("IncludeArchivedOption");
      const pgArchivedColumnIsBoolean = archivedColumn.type.category === "B";

      const notArchivedFragment = pgArchivedColumnIsBoolean
        ? sql.fragment`false`
        : sql.fragment`null`;

      addArgDataGenerator(function connectionCondition({ includeArchived }) {
        return {
          pgQuery: queryBuilder => {
            if (
              includeArchived === "INHERIT" &&
              isPgBackwardRelationField &&
              queryBuilder.parentQueryBuilder &&
              getArchivedColumn(parentTable)
            ) {
              const parentTableArchivedColumn = getArchivedColumn(parentTable);
              const pgParentArchivedColumnIsBoolean =
                parentTableArchivedColumn.type.category === "B";

              const parentNotArchivedFragment = pgParentArchivedColumnIsBoolean
                ? sql.fragment`false`
                : sql.fragment`null`;
              const sqlParentTableAlias = queryBuilder.parentQueryBuilder.getTableAlias();
              queryBuilder.where(
                sql.fragment`(${sqlParentTableAlias}.${sql.identifier(
                  parentTableArchivedColumn.name
                )} IS NOT ${parentNotArchivedFragment} OR ${queryBuilder.getTableAlias()}.${sql.identifier(
                  archivedColumn.name
                )} is ${notArchivedFragment})`
              );
            } else if (
              includeArchived === "NO" ||
              // INHERIT is equivalent to NO if there's no valid parent
              includeArchived === "INHERIT"
            ) {
              queryBuilder.where(
                sql.fragment`${queryBuilder.getTableAlias()}.${sql.identifier(
                  archivedColumn.name
                )} is ${notArchivedFragment}`
              );
            } else if (includeArchived === "EXCLUSIVELY") {
              queryBuilder.where(
                sql.fragment`${queryBuilder.getTableAlias()}.${sql.identifier(
                  archivedColumn.name
                )} is not ${notArchivedFragment}`
              );
            }
          },
        };
      });

      return extend(
        args,
        {
          includeArchived: {
            description:
              "Indicates whether archived items should be included in the results or not.",
            type: IncludeArchivedOption,
            defaultValue: "INHERIT",
          },
        },
        `Adding includeArchived argument to connection field '${
          field.name
        }' of '${Self.name}'`
      );
    }
  );
};

const Plugin = makePluginByCombiningPlugins(
  AddIncludeArchivedOptionEnumPlugin,
  PgOmitArchivedInnerPlugin
);
Plugin.displayName = "PgOmitArchivedPlugin";
module.exports = Plugin;
