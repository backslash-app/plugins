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

const getPriorityIcon = (prio) => {
  switch (prio) {
    case 2: return '△'; // high priority
    case 0: return '▽'; // low priority
    default: return '◇';
  }
};

const getPriorityText = (prio) => {
  switch (prio) {
    case 2: return 'High';
    case 0: return 'Low';
    default: return 'Medium';
  }
};

const run = async (query, { axios }) => {
  try {
    const todos = (await loadTodos()).filter((todo) => todo.title.includes(query) || todo.notes.includes(query));
    
    if (todos.length === 0) {
      return [];
    }

    // Sort todos by priority (high to low) then by completion status
    const sortedTodos = todos.sort((a, b) => {
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1; // completed todos at bottom
      }
      return b.prio - a.prio; // high priority first
    });

    return sortedTodos.map((todo) => ({
      data: {
        id: todo.title,
        title: todo.title,
        completed: todo.completed,
        notes: todo.notes,
        prio: todo.prio
      },
      content: [
        {
          type: 'div',
          className: 'flex items-center w-full gap-2',
          props: {
            style: todo.completed
              ? { opacity: 0.6 }
              : {}
          },
          children: [
            {
              type: 'span',
              content: todo.completed ? '✅' : '⬜',
              className: 'text-lg'
            },
            {
              type: 'div',
              className: 'flex-1',
              children: [
                {
                  type: 'title',
                  content: todo.title,
                  className: todo.completed ? 'line-through text-gray-500' : ''
                },
                ...(todo.notes ? [{
                  type: 'span',
                  content: todo.notes,
                  className: 'text-sm! text-gray-600! ml-4'
                }] : [])
              ]
            },
            {
              type: 'div',
              content: getPriorityText(todo.prio) + " " + getPriorityIcon(todo.prio),
              className: 'rounded-lg text-sm px-2',
              props: {
                style:
                  todo.prio === 2
                    ? { backgroundColor: '#fee2e2', color: '#991b1b' }
                    : todo.prio === 0
                    ? { backgroundColor: '#dcfce7', color: '#166534' }
                    : { backgroundColor: '#fef9c3', color: '#a16207' }
              }
            }
          ]
        }
      ]
    }));
    
  } catch (error) {
    console.error('Error loading todos:', error.message);
    return [];
  }
};

const markAsCompleted = async (todo) => {
  try {
    const todos = await loadTodos();
    const todoIndex = todos.findIndex(t => t.id === todo.id);
    
    if (todoIndex === -1) {
      console.log('Todo not found');
      return;
    }
    
    todos[todoIndex].completed = !todos[todoIndex].completed;
    await saveTodos(todos);
    
    const status = todos[todoIndex].completed ? 'completed' : 'reopened';
    console.log(`Todo "${todo.title}" ${status}`);
    
  } catch (error) {
    console.error('Error updating todo:', error.message);
  }
};

const deleteTodo = async (todo) => {
  try {
    const todos = await loadTodos();
    const filteredTodos = todos.filter(t => t.id !== todo.id);
    
    if (filteredTodos.length === todos.length) {
      console.log('Todo not found');
      return;
    }
    
    await saveTodos(filteredTodos);
    console.log(`Todo "${todo.title}" deleted`);
  } catch (error) {
    console.error('Error deleting todo:', error.message);
  }
};

module.exports = {
  run,
  actions: [
    { name: 'Mark as completed', action: markAsCompleted },
    { name: 'Delete todo', action: deleteTodo }
  ]
};