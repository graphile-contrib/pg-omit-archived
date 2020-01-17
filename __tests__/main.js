const { graphql } = require("graphql");
const pg = require("pg");
const {
  createPostGraphileSchema,
  withPostGraphileContext,
} = require("postgraphile");
const SQL = `
drop schema if exists omit_archived cascade;
create schema omit_archived;
create table omit_archived.parents (
  id int primary key,
  name text,
  is_archived boolean not null default false
);
create table omit_archived.children (
  id int primary key,
  parent_id int not null references omit_archived.parents,
  name text,
  is_archived boolean not null default false
);
create index on omit_archived.children(parent_id);
insert into omit_archived.parents (id, name, is_archived) values (1, 'First', false), (2, 'Second', true);
insert into omit_archived.children (id, parent_id, name, is_archived) values
  (1001, 1, 'First child 1', false), (1002, 1, 'First child 2', true),
  (2001, 2, 'Second child 1', false), (2002, 2, 'Second child 2', true);
`;

function iderize(...ids) {
  return ids.map(id => ({ id }));
}

let pgPool;
let schema;
const options = {
  appendPlugins: [require("..")],
  simpleCollections: "both",
};
beforeAll(() => {
  pgPool = new pg.Pool({
    connectionString: process.env.TEST_DATABASE_URL || "pggql_test",
  });
});
beforeAll(() => pgPool.query(SQL));
beforeAll(async () => {
  schema = await createPostGraphileSchema(pgPool, ["omit_archived"], options);
});
afterAll(() => pgPool.end());

function check(query, expected) {
  const rootValue = null;
  const variables = {};
  const operationName = null;
  return () =>
    withPostGraphileContext(
      {
        pgPool,
        ...options,
      },
      async context => {
        const result = await graphql(
          schema,
          query,
          rootValue,
          context,
          variables,
          operationName,
        );
        expect(result.errors).toBeFalsy();
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
          allParents(includeArchived: NO) {
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
          allParents(includeArchived: YES) {
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
          allParents(includeArchived: EXCLUSIVELY) {
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
          allChildren(includeArchived: NO) {
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
          allChildren(includeArchived: YES) {
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
          allChildren(includeArchived: EXCLUSIVELY) {
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
          allParents(includeArchived: NO) {
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
          allParents(includeArchived: YES) {
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
          allParents(includeArchived: EXCLUSIVELY) {
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
          allParentsList(includeArchived: NO) {
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
          allParentsList(includeArchived: YES) {
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
          allParentsList(includeArchived: EXCLUSIVELY) {
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
          allChildrenList(includeArchived: NO) {
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
          allChildrenList(includeArchived: YES) {
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
          allChildrenList(includeArchived: EXCLUSIVELY) {
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
          allParentsList(includeArchived: NO) {
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
          allParentsList(includeArchived: YES) {
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
          allParentsList(includeArchived: EXCLUSIVELY) {
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
