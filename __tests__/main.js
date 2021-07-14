const { graphql } = require("graphql");
const pg = require("pg");
const {
  createPostGraphileSchema,
  withPostGraphileContext,
} = require("postgraphile");

/*
 * In this database we add four columns:
 *
 * - is_archived - boolean, true if hidden by default
 * - archived_at - nullable timestamp, non-null if hidden by default
 * - is_published - boolean, false if hidden by default
 * - published_at - nullable timestamp, null if hidden by default
 *
 * In a normal database you'd only have one of these, we just add 4 so we can
 * run the tests for each of these combinations.
 */

const SQL = `
drop schema if exists omit_archived cascade;
create schema omit_archived;
create table omit_archived.parents (
  id int primary key,
  name text,
  is_archived boolean not null default false,
  archived_at timestamptz default null,
  is_published boolean not null default true,
  published_at timestamptz default now()
);
create table omit_archived.children (
  id int primary key,
  parent_id int not null references omit_archived.parents,
  name text,
  is_archived boolean not null default false,
  archived_at timestamptz default null,
  is_published boolean not null default true,
  published_at timestamptz default now()
);
create index on omit_archived.children(parent_id);
create table omit_archived.other_children (
  id int primary key,
  parent_id int not null references omit_archived.parents,
  title text
);
insert into omit_archived.parents (id, name, is_archived, archived_at, is_published, published_at)
  values (1, 'First', false, null, true, now()), (2, 'Second', true, now(), false, null);
insert into omit_archived.children (id, parent_id, name, is_archived, archived_at, is_published, published_at) values
  (1001, 1, 'First child 1', false, null, true, now()),
  (1002, 1, 'First child 2', true, now(), false, null),
  (2001, 2, 'Second child 1', false, null, true, now()),
  (2002, 2, 'Second child 2', true, now(), false, null);
insert into omit_archived.other_children (id, parent_id, title) values
  (101, 1, 'First other child 1'),
  (102, 1, 'First other child 2'),
  (201, 2, 'Second other child 1'),
  (202, 2, 'Second other child 2');
`;

function iderize(...ids) {
  return ids.map((id) => ({ id }));
}

let pgPool;
beforeAll(() => {
  pgPool = new pg.Pool({
    connectionString: process.env.TEST_DATABASE_URL || "pggql_test",
  });
});
beforeAll(() => pgPool.query(SQL));
afterAll(() => pgPool.end());

describe.each([
  ["default"],
  [
    "is_archived",
    "archived",
    { pgArchivedColumnName: "is_archived", pgArchivedRelations: true },
  ],
  [
    "archived_at",
    "archived",
    { pgArchivedColumnName: "archived_at", pgArchivedRelations: true },
  ],
  [
    "is_published",
    "draft",
    {
      pgDraftColumnName: "is_published",
      pgDraftColumnImpliesVisible: true,
      pgDraftRelations: true,
    },
  ],
  [
    "published_at",
    "draft",
    {
      pgDraftColumnName: "published_at",
      pgDraftColumnImpliesVisible: true,
      pgDraftRelations: true,
    },
  ],
])("%s", (_columnName, keyword, graphileBuildOptions) => {
  const Keyword = keyword
    ? keyword[0].toUpperCase() + keyword.slice(1)
    : `Archived`;
  let schema;
  const options = {
    appendPlugins: [
      keyword ? require("..").custom(keyword) : require("..").default,
    ],
    simpleCollections: "both",
    graphileBuildOptions,
  };
  beforeAll(async () => {
    schema = await createPostGraphileSchema(pgPool, ["omit_archived"], options);
  });

  function check(query, expected, checker) {
    const rootValue = null;
    const variables = {};
    const operationName = null;
    return () =>
      withPostGraphileContext(
        {
          pgPool,
          ...options,
        },
        async (context) => {
          const result = await graphql(
            schema,
            query,
            rootValue,
            context,
            variables,
            operationName,
          );
          if (checker) {
            checker(result);
          } else {
            expect(result.errors).toBeFalsy();
          }
          expect(result.data).toEqual(expected);
        },
      );
  }

  describe("connections", () => {
    describe("parents", () => {
      test(
        "Omits archived parents by default",
        check(
          `{
          allParents {
            nodes {
              id
            }
          }
        }`,
          { allParents: { nodes: iderize(1) } },
        ),
      );

      test(
        "Omits archived parents when NO",
        check(
          `{
          allParents(include${Keyword}: NO) {
            nodes {
              id
            }
          }
        }`,
          { allParents: { nodes: iderize(1) } },
        ),
      );

      test(
        "Includes everything when YES",
        check(
          `{
          allParents(include${Keyword}: YES) {
            nodes {
              id
            }
          }
        }`,
          { allParents: { nodes: iderize(1, 2) } },
        ),
      );

      test(
        "Includes only archived when EXCLUSIVELY",
        check(
          `{
          allParents(include${Keyword}: EXCLUSIVELY) {
            nodes {
              id
            }
          }
        }`,
          { allParents: { nodes: iderize(2) } },
        ),
      );
    });

    describe("children", () => {
      test(
        "Omits archived children by default",
        check(
          `{
          allChildren {
            nodes {
              id
            }
          }
        }`,
          { allChildren: { nodes: iderize(1001, 2001) } },
        ),
      );

      test(
        "Omits archived children when NO",
        check(
          `{
          allChildren(include${Keyword}: NO) {
            nodes {
              id
            }
          }
        }`,
          { allChildren: { nodes: iderize(1001, 2001) } },
        ),
      );

      test(
        "Includes everything when YES",
        check(
          `{
          allChildren(include${Keyword}: YES) {
            nodes {
              id
            }
          }
        }`,
          {
            allChildren: {
              nodes: iderize(1001, 1002, 2001, 2002),
            },
          },
        ),
      );

      test(
        "Includes only archived when EXCLUSIVELY",
        check(
          `{
          allChildren(include${Keyword}: EXCLUSIVELY) {
            nodes {
              id
            }
          }
        }`,
          { allChildren: { nodes: iderize(1002, 2002) } },
        ),
      );
    });

    describe("children of parents", () => {
      test(
        "Omits archived parents and children by default",
        check(
          `{
          allParents {
            nodes {
              id
              childrenByParentId {
                nodes {
                  id
                }
              }
            }
          }
        }`,
          {
            allParents: {
              nodes: [
                {
                  id: 1,
                  childrenByParentId: { nodes: iderize(1001) },
                },
              ],
            },
          },
        ),
      );

      test(
        "Omits archived parents and children when NO",
        check(
          `{
          allParents(include${Keyword}: NO) {
            nodes {
              id
              childrenByParentId {
                nodes {
                  id
                }
              }
            }
          }
        }`,
          {
            allParents: {
              nodes: [
                {
                  id: 1,
                  childrenByParentId: { nodes: iderize(1001) },
                },
              ],
            },
          },
        ),
      );

      test(
        "Includes all parents, and treats children as INHERIT (all children of an archived parent, but only the unarchived children of an unarchived parent) when YES",
        check(
          `{
          allParents(include${Keyword}: YES) {
            nodes {
              id
              childrenByParentId {
                nodes {
                  id
                }
              }
            }
          }
        }`,
          {
            allParents: {
              nodes: [
                {
                  id: 1,
                  childrenByParentId: { nodes: iderize(1001) },
                },
                {
                  id: 2,
                  childrenByParentId: { nodes: iderize(2001, 2002) },
                },
              ],
            },
          },
        ),
      );

      test(
        "Includes only archived parents (and all their children) when EXCLUSIVELY",
        check(
          `{
          allParents(include${Keyword}: EXCLUSIVELY) {
            nodes {
              id
              childrenByParentId {
                nodes {
                  id
                }
              }
            }
          }
        }`,
          {
            allParents: {
              nodes: [
                {
                  id: 2,
                  childrenByParentId: { nodes: iderize(2001, 2002) },
                },
              ],
            },
          },
        ),
      );
    });
  });

  describe("simple collections", () => {
    describe("parents", () => {
      test(
        "Omits archived parents by default",
        check(
          `{
          allParentsList {
            id
          }
        }`,
          { allParentsList: iderize(1) },
        ),
      );

      test(
        "Omits archived parents when NO",
        check(
          `{
          allParentsList(include${Keyword}: NO) {
            id
          }
        }`,
          { allParentsList: iderize(1) },
        ),
      );

      test(
        "Includes everything when YES",
        check(
          `{
          allParentsList(include${Keyword}: YES) {
            id
          }
        }`,
          { allParentsList: iderize(1, 2) },
        ),
      );

      test(
        "Includes only archived when EXCLUSIVELY",
        check(
          `{
          allParentsList(include${Keyword}: EXCLUSIVELY) {
            id
          }
        }`,
          { allParentsList: iderize(2) },
        ),
      );
    });

    describe("children", () => {
      test(
        "Omits archived children by default",
        check(
          `{
          allChildrenList {
            id
          }
        }`,
          { allChildrenList: iderize(1001, 2001) },
        ),
      );

      test(
        "Omits archived children when NO",
        check(
          `{
          allChildrenList(include${Keyword}: NO) {
            id
          }
        }`,
          { allChildrenList: iderize(1001, 2001) },
        ),
      );

      test(
        "Includes everything when YES",
        check(
          `{
          allChildrenList(include${Keyword}: YES) {
            id
          }
        }`,
          {
            allChildrenList: iderize(1001, 1002, 2001, 2002),
          },
        ),
      );

      test(
        "Includes only archived when EXCLUSIVELY",
        check(
          `{
          allChildrenList(include${Keyword}: EXCLUSIVELY) {
            id
          }
        }`,
          { allChildrenList: iderize(1002, 2002) },
        ),
      );
    });

    describe("children of parents", () => {
      test(
        "Omits archived parents and children by default",
        check(
          `{
          allParentsList {
            id
            childrenByParentIdList {
              id
            }
          }
        }`,
          {
            allParentsList: [
              {
                id: 1,
                childrenByParentIdList: iderize(1001),
              },
            ],
          },
        ),
      );

      test(
        "Omits archived parents and children when NO",
        check(
          `{
          allParentsList(include${Keyword}: NO) {
            id
            childrenByParentIdList {
              id
            }
          }
        }`,
          {
            allParentsList: [
              {
                id: 1,
                childrenByParentIdList: iderize(1001),
              },
            ],
          },
        ),
      );

      test(
        "Includes all parents, and treats children as INHERIT (all children of an archived parent, but only the unarchived children of an unarchived parent) when YES",
        check(
          `{
          allParentsList(include${Keyword}: YES) {
            id
            childrenByParentIdList {
              id
            }
          }
        }`,
          {
            allParentsList: [
              {
                id: 1,
                childrenByParentIdList: iderize(1001),
              },
              {
                id: 2,
                childrenByParentIdList: iderize(2001, 2002),
              },
            ],
          },
        ),
      );

      test(
        "Includes only archived parents (and all their children) when EXCLUSIVELY",
        check(
          `{
          allParentsList(include${Keyword}: EXCLUSIVELY) {
            id
            childrenByParentIdList {
              id
            }
          }
        }`,
          {
            allParentsList: [
              {
                id: 2,
                childrenByParentIdList: iderize(2001, 2002),
              },
            ],
          },
        ),
      );
    });
  });

  const pgRelationsAttr = `pg${Keyword}Relations`;
  if (graphileBuildOptions && graphileBuildOptions[pgRelationsAttr]) {
    describe(pgRelationsAttr, () => {
      it(
        "Defaults to omitting other_children where parent is archived",
        check(
          /* GraphQL */ `
            {
              allOtherChildrenList {
                id
              }
            }
          `,
          {
            allOtherChildrenList: iderize(101, 102),
          },
        ),
      );
      it(
        "Includes only other_children of non-archived parents when NO",
        check(
          /* GraphQL */ `
            {
              allOtherChildrenList(include${Keyword}: NO) {
                id
              }
            }
          `,
          {
            allOtherChildrenList: iderize(101, 102),
          },
        ),
      );
      it(
        "Includes all other_children of all parents when YES",
        check(
          /* GraphQL */ `
            {
              allOtherChildrenList(include${Keyword}: YES) {
                id
              }
            }
          `,
          {
            allOtherChildrenList: iderize(101, 102, 201, 202),
          },
        ),
      );
      it(
        "Includes only other_children of archived parents when EXCLUSIVELY",
        check(
          /* GraphQL */ `
            {
              allOtherChildrenList(include${Keyword}: EXCLUSIVELY) {
                id
              }
            }
          `,
          {
            allOtherChildrenList: iderize(201, 202),
          },
        ),
      );
    });
  } else {
    describe(`${pgRelationsAttr} DISABLED`, () => {
      it(
        "Does not contain the omit archived fields on OtherChildren",
        check(
          /* GraphQL */ `
            {
              allOtherChildrenList(include${Keyword}: EXCLUSIVELY) {
                id
              }
            }
          `,
          undefined,
          (result) => {
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0].message).toMatch(
              `Unknown argument "include${Keyword}"`,
            );
          },
        ),
      );
    });
  }
});
