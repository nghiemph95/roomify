const PROJECT_PREFIX = 'roomify_project_';

const jsonError = (status, message, extra = {}) =>
  new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });

const getUserId = async userPuter => {
  try {
    const user = await userPuter.auth.getUser();
    return user?.uuid || null;
  } catch (error) {
    return null;
  }
};

// GET /api/projects/list – list all projects (keys with PROJECT_PREFIX)
router.get('/api/projects/list', async ({ request, user }) => {
  try {
    if (!user?.puter) {
      return jsonError(401, 'User not authenticated');
    }

    const userPuter = user.puter;
    const keysResult = await userPuter.kv.list(`${PROJECT_PREFIX}*`);

    let keys = [];
    if (Array.isArray(keysResult)) {
      keys = keysResult;
    } else if (keysResult && typeof keysResult === 'object' && Array.isArray(keysResult.keys)) {
      keys = keysResult.keys;
    } else if (keysResult && typeof keysResult === 'object') {
      keys = Object.keys(keysResult);
    }

    const values = await Promise.all(
      keys.map(async key => {
        try {
          return await userPuter.kv.get(key);
        } catch {
          return null;
        }
      })
    );

    const projects = values.filter(Boolean);

    return { projects };
  } catch (e) {
    return jsonError(500, 'Failed to list projects', {
      message: e?.message || 'Unknown error',
    });
  }
});

// GET /api/projects/get?id=... – get one project by id
router.get('/api/projects/get', async ({ request, user }) => {
  try {
    if (!user?.puter) {
      return jsonError(401, 'User not authenticated');
    }

    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return jsonError(400, 'Missing id search parameter');
    }

    const userPuter = user.puter;
    const key = `${PROJECT_PREFIX}${id}`;
    const project = await userPuter.kv.get(key);

    if (project == null) {
      return jsonError(404, 'Project not found', { id });
    }

    return { project };
  } catch (e) {
    return jsonError(500, 'Failed to get project', {
      message: e?.message || 'Unknown error',
    });
  }
});

router.post('/api/projects/save', async ({ request, user }) => {
  try {
    const userPuter = user.puter;

    if (!userPuter) return jsonError(401, 'User not authenticated');

    let body;
    try {
      body = await request.json();
    } catch (parseErr) {
      return jsonError(400, 'Invalid request body (expect JSON with project)', {
        message: parseErr?.message || 'Failed to parse JSON',
      });
    }

    const project = body?.project;

    if (!project || typeof project !== 'object') {
      return jsonError(400, 'Project is required', { received: !!body?.project });
    }
    if (!project.sourceImage || typeof project.sourceImage !== 'string') {
      return jsonError(400, 'Project is required (sourceImage is mandatory)');
    }

    const payload = {
      ...project,
      updatedAt: new Date().toISOString(),
    };

    const userId = await getUserId(userPuter);

    if (!userId) return jsonError(401, 'User not authenticated');

    const key = `${PROJECT_PREFIX}${project.id ?? userId}`;
    await userPuter.kv.set(key, payload);

    return { saved: true, id: project.id, project: payload };
  } catch (e) {
    return jsonError(500, 'Failed to save project', {
      message: e.message || 'Unknown error',
    });
  }
});
