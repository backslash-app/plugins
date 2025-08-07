const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const TODOS_FILE = path.join(os.homedir(), '.config', 'bs-plugin-todos.json');

const ensureTodosFile = async () => {
  try {
    await fs.access(TODOS_FILE);
  } catch (error) {
    // File doesn't exist, create it with empty array
    await fs.mkdir(path.dirname(TODOS_FILE), { recursive: true });
    await fs.writeFile(TODOS_FILE, JSON.stringify([], null, 2));
  }
};

const loadTodos = async () => {
  await ensureTodosFile();
  const data = await fs.readFile(TODOS_FILE, 'utf8');

  // Check if file is empty
  if (!data.trim()) {
    await fs.writeFile(TODOS_FILE, JSON.stringify([], null, 2));
    return [];
  }

  return JSON.parse(data);
};

const saveTodos = async (todos) => {
  await fs.writeFile(TODOS_FILE, JSON.stringify(todos, null, 2));
};

const parseTodoQuery = (query) => {
  let title = query.trim();
  let prio = 1; // default medium priority
  let notes = '';

  // Check for priority markers
  if (title.startsWith('!')) {
    prio = 2; // high priority
    title = title.substring(1).trim();
  } else if (title.startsWith('-')) {
    prio = 0; // low priority
    title = title.substring(1).trim();
  }

  // Check for notes (anything after " -- ")
  const notesSeparator = title.indexOf(' -- ');
  if (notesSeparator !== -1) {
    notes = title.substring(notesSeparator + 4).trim();
    title = title.substring(0, notesSeparator).trim();
  }

  return { title, prio, notes };
};

const run = async (query, { axios }) => {
  if (!query.trim()) {
    return [];
  }

  try {
    const { title, prio, notes } = parseTodoQuery(query);
    const prioText = prio === 2 ? ' (high priority)' : prio === 0 ? ' (low priority)' : ' (medium priority)';
    const prioIcon = prio === 2 ? '△' : prio === 0 ? '▽' : '◇';

    return [{
      data: {
        id: query,
        title,
        notes,
        prio,
        originalQuery: query
      },
      content: [
        {
          type: 'div',
          className: 'flex items-center w-full gap-2',
          children: [
            {
              type: 'title',
              content: `Add todo: ${title}`,
            },
            {
              type: 'p',
              content: notes ? `Notes: ${notes}` : 'No notes',
              className: 'flex-1'
            },
            {
              type: 'badge',
              content: `${prioIcon} ${prioText.trim()}`,
            }
          ]
        }
      ]
    }];
  } catch (error) {
    console.error('Error parsing todo:', error.message);
    return [];
  }
};

const saveTodo = async (todoData, { clipboard }) => {
  try {
    const todos = await loadTodos();
    
    const newTodo = {
      id: todoData.title,
      title: todoData.title,
      completed: false,
      notes: todoData.notes,
      prio: todoData.prio,
    };

    todos.push(newTodo);
    await saveTodos(todos);
  } catch (error) {
    console.error('Error saving todo:', error.message);
  }
};

module.exports = {
  run,
  actions: [
    { title: 'Save Todo', action: saveTodo }
  ]
};