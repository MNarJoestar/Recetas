const DB_NAME = 'recetario-personal-db';
const STORE_NAME = 'recipes';
let database;
let selectedPhoto = null;
let editingRecipeId = null;
let editingRecipeCreatedAt = null;

const screens = [...document.querySelectorAll('.screen')];
const recipeForm = document.getElementById('recipeForm');
const photoInput = document.getElementById('recipePhoto');
const photoPreview = document.getElementById('photoPreview');
const formMessage = document.getElementById('formMessage');
const dictationButton = document.getElementById('dictationButton');
const dictationStatus = document.getElementById('dictationStatus');
const dictationLanguage = document.getElementById('dictationLanguage');

// Reconocimiento de voz con soporte para navegadores móviles (Chrome/Safari)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let dictationBaseText = '';
let dictationActive = false;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = dictationLanguage.value;
  recognition.continuous = true;

  dictationLanguage.addEventListener('change', () => {
    recognition.lang = dictationLanguage.value;
    dictationStatus.textContent = `Idioma del dictado: ${dictationLanguage.selectedOptions[0].textContent}.`;
  });
  recognition.interimResults = true;

  recognition.onstart = () => {
    dictationButton.textContent = 'Detener grabación';
    dictationButton.classList.add('dictation-button-recording');
    dictationStatus.textContent = 'Escuchando… Habla con claridad.';
  };

  recognition.onresult = (event) => {
    const transcript = [...event.results].map((result) => result[0].transcript).join('').trim();
    recipeForm.elements.steps.value = [dictationBaseText, transcript].filter(Boolean).join('\n');
  };

  recognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      dictationActive = false;
      dictationStatus.textContent = 'No se concedió permiso para el micrófono o el servicio de voz.';
    } else if (event.error === 'no-speech') {
      dictationStatus.textContent = 'No se detectó voz. Puedes seguir hablando o detener la grabación.';
    } else {
      dictationActive = false;
      dictationStatus.textContent = 'Hubo un problema con el dictado. Revisa el micrófono e inténtalo de nuevo.';
    }
  };

  recognition.onend = () => {
    if (dictationActive) {
      // Algunos navegadores móviles terminan el reconocimiento tras una pausa; conservar lo transcrito y reanudar.
      dictationBaseText = recipeForm.elements.steps.value.trim();
      window.setTimeout(() => {
        if (!dictationActive) return;
        try {
          recognition.start();
        } catch (error) {
          dictationActive = false;
          dictationStatus.textContent = 'El dictado se detuvo. Puedes volver a iniciarlo o corregir el texto.';
          dictationButton.textContent = 'Grabar paso a paso';
          dictationButton.classList.remove('dictation-button-recording');
        }
      }, 300);
      return;
    }

    dictationButton.textContent = 'Grabar paso a paso';
    dictationButton.classList.remove('dictation-button-recording');
    if (!dictationStatus.textContent.startsWith('No se concedió') &&
        !dictationStatus.textContent.startsWith('Hubo un problema')) {
      dictationStatus.textContent = 'Dictado terminado. Puedes revisar y corregir el texto.';
    }
  };

  dictationButton.addEventListener('click', () => {
    if (dictationActive) {
      dictationActive = false;
      recognition.stop();
      return;
    }
    dictationBaseText = recipeForm.elements.steps.value.trim();
    dictationActive = true;
    dictationStatus.textContent = 'Solicitando acceso al micrófono…';
    try {
      recognition.start();
    } catch (error) {
      dictationActive = false;
      dictationStatus.textContent = 'No se pudo iniciar. Revisa el permiso del micrófono e inténtalo de nuevo.';
    }
  });
} else {
  dictationButton.disabled = true;
  dictationStatus.textContent = 'El dictado por voz no está disponible en este navegador.';
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storeRequest(mode, operation) {
  return new Promise((resolve, reject) => {
    if (!database) {
      reject(new Error('La base de datos no está disponible.'));
      return;
    }
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function showScreen(name) {
  screens.forEach((screen) => screen.classList.toggle('hidden', screen.id !== `${name}Screen`));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'list') renderRecipeList();
  if (name === 'form' && editingRecipeId === null) {
    recipeForm.reset();
    editingRecipeId = null;
    editingRecipeCreatedAt = null;
    selectedPhoto = null;
    photoInput.value = '';
    photoPreview.innerHTML = '';
    photoPreview.classList.add('hidden');
    formMessage.textContent = '';
    dictationStatus.textContent = recognition
      ? 'Puedes dictar y luego corregir el texto aquí.'
      : 'El dictado por voz no está disponible en este navegador.';
    document.getElementById('formHeading').textContent = 'Nueva receta';
    recipeForm.querySelector('.save-button').textContent = 'Guardar receta';
  }
}

document.querySelectorAll('[data-screen]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.screen === 'form' && !button.hasAttribute('data-editing')) {
      editingRecipeId = null;
    }
    showScreen(button.dataset.screen);
  });
});

// Función para optimizar imágenes y ahorrar almacenamiento
function compressImage(file, maxWidth = 800, quality = 0.75) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
      };
    };
  });
}

photoInput.addEventListener('change', async () => {
  const file = photoInput.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    formMessage.textContent = 'Selecciona un archivo de imagen válido.';
    photoInput.value = '';
    return;
  }
  
  formMessage.textContent = 'Procesando imagen...';
  selectedPhoto = await compressImage(file);
  
  photoPreview.innerHTML = '';
  const image = document.createElement('img');
  const previewUrl = URL.createObjectURL(selectedPhoto);
  image.src = previewUrl;
  image.alt = 'Vista previa de la foto de la receta';
  image.onload = () => URL.revokeObjectURL(previewUrl);
  photoPreview.append(image);
  photoPreview.classList.remove('hidden');
  formMessage.textContent = '';
});

recipeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  formMessage.textContent = '';

  const recipe = {
    title: recipeForm.elements.title.value.trim(),
    ingredients: recipeForm.elements.ingredients.value.trim(),
    steps: recipeForm.elements.steps.value.trim(),
    photo: selectedPhoto || null,
    createdAt: Date.now()
  };

  if (editingRecipeId !== null) {
    recipe.id = editingRecipeId;
    recipe.createdAt = editingRecipeCreatedAt;
  }

  if (!recipe.title || !recipe.ingredients || !recipe.steps) {
    formMessage.textContent = 'Completa el nombre, los ingredientes y el paso a paso.';
    return;
  }

  try {
    await storeRequest('readwrite', (store) => (
      editingRecipeId === null ? store.add(recipe) : store.put(recipe)
    ));
    editingRecipeId = null;
    selectedPhoto = null;
    photoInput.value = '';
    showScreen('list');
  } catch (error) {
    console.error('No se pudo guardar la receta:', error);
    formMessage.textContent = 'No se pudo guardar. Revisa el espacio disponible en el dispositivo.';
  }
});

async function renderRecipeList() {
  const list = document.getElementById('recipeList');
  list.innerHTML = '';
  try {
    const recipes = await storeRequest('readonly', (store) => store.getAll());
    recipes.sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
    if (recipes.length === 0) {
      list.innerHTML = '<div class="empty-state"><strong>Aún no hay recetas</strong>Agrega tu primera receta con el botón + de la pantalla principal.</div>';
      return;
    }
    recipes.forEach((recipe, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recipe-card';
      button.innerHTML = `<span class="recipe-card-number">${String(index + 1).padStart(2, '0')}</span><span class="recipe-card-title"></span><span class="recipe-card-arrow" aria-hidden="true">›</span>`;
      button.querySelector('.recipe-card-title').textContent = recipe.title;
      button.addEventListener('click', () => openRecipe(recipe.id));
      list.append(button);
    });
  } catch (error) {
    console.error('No se pudieron cargar las recetas:', error);
    list.innerHTML = '<div class="empty-state">No se pudieron cargar las recetas guardadas en este dispositivo.</div>';
  }
}

async function openRecipe(id) {
  try {
    const recipe = await storeRequest('readonly', (store) => store.get(id));
    if (!recipe) return;
    renderRecipeDetail(recipe);
    showScreen('detail');
  } catch (error) {
    console.error('No se pudo abrir la receta:', error);
  }
}

function beginEditing(recipe) {
  editingRecipeId = recipe.id;
  editingRecipeCreatedAt = recipe.createdAt;
  selectedPhoto = recipe.photo || null;
  photoInput.value = '';

  recipeForm.elements.title.value = recipe.title;
  recipeForm.elements.ingredients.value = recipe.ingredients;
  recipeForm.elements.steps.value = recipe.steps;

  document.getElementById('formHeading').textContent = 'Editar receta';
  recipeForm.querySelector('.save-button').textContent = 'Guardar cambios';

  photoPreview.innerHTML = '';
  if (selectedPhoto) {
    const image = document.createElement('img');
    const previewUrl = URL.createObjectURL(selectedPhoto);
    image.src = previewUrl;
    image.alt = 'Vista previa de la foto de la receta';
    image.onload = () => URL.revokeObjectURL(previewUrl);
    photoPreview.append(image);
    photoPreview.classList.remove('hidden');
  } else {
    photoPreview.classList.add('hidden');
  }

  showScreen('form');
}

async function deleteRecipe(id) {
  if (!window.confirm('¿Seguro que quieres eliminar esta receta? Esta acción no se puede deshacer.')) return;
  try {
    await storeRequest('readwrite', (store) => store.delete(id));
    showScreen('list');
  } catch (error) {
    console.error('No se pudo eliminar la receta:', error);
    window.alert('No se pudo eliminar la receta. Inténtalo de nuevo.');
  }
}

function renderRecipeDetail(recipe) {
  const detail = document.getElementById('recipeDetail');
  detail.replaceChildren();

  const titleRow = document.createElement('div');
  titleRow.className = 'detail-title-row';
  const title = document.createElement('h2');
  title.id = 'detailTitle';
  title.textContent = recipe.title;
  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'word-button';
  exportButton.setAttribute('aria-label', 'Exportar receta a Word');
  exportButton.title = 'Exportar a Word';
  exportButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm0 2 4 4h-4zM8.2 17.8 6.8 11h1.8l.7 4.1.8-4.1h1.7l.8 4.1.7-4.1H15l-1.5 6.8h-1.8l-.8-3.9-.8 3.9z"/></svg>';
  exportButton.addEventListener('click', () => exportToWord(recipe));
  titleRow.append(title, exportButton);
  detail.append(titleRow);

  const recipeActions = document.createElement('div');
  recipeActions.className = 'recipe-actions';
  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.className = 'button button-edit';
  editButton.textContent = 'Editar receta';
  editButton.addEventListener('click', () => beginEditing(recipe));
  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'button button-delete';
  deleteButton.textContent = 'Eliminar receta';
  deleteButton.addEventListener('click', () => deleteRecipe(recipe.id));
  recipeActions.append(editButton, deleteButton);
  detail.append(recipeActions);

  if (recipe.photo) {
    const image = document.createElement('img');
    image.className = 'recipe-photo';
    const photoUrl = URL.createObjectURL(recipe.photo);
    image.src = photoUrl;
    image.alt = `Foto de ${recipe.title}`;
    image.onload = () => URL.revokeObjectURL(photoUrl);
    detail.append(image);
  } else {
    const noPhoto = document.createElement('div');
    noPhoto.className = 'recipe-photo no-photo';
    noPhoto.textContent = 'Sin foto para esta receta';
    detail.append(noPhoto);
  }

  const ingredients = document.createElement('section');
  ingredients.className = 'detail-section';
  ingredients.innerHTML = '<h3>Ingredientes</h3><p class="ingredients-text"></p>';
  ingredients.querySelector('p').textContent = recipe.ingredients;
  const steps = document.createElement('section');
  steps.className = 'detail-section';
  steps.innerHTML = '<h3>Paso a paso</h3><p class="steps-text"></p>';
  steps.querySelector('p').textContent = recipe.steps;
  detail.append(ingredients, steps);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

async function exportToWord(recipe) {
  const imageData = recipe.photo ? await blobToDataUrl(recipe.photo) : '';
  const photoMarkup = imageData ? `<p style="text-align:center"><img src="${imageData}" alt="Foto de la receta" style="max-width:480px;max-height:360px" /></p>` : '';
  const documentContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif;color:#263c32}h1{color:#263c32}h2{color:#b95f42}p{line-height:1.6;white-space:pre-wrap}</style></head><body><h1>${escapeHtml(recipe.title)}</h1>${photoMarkup}<h2>Ingredientes</h2><p>${escapeHtml(recipe.ingredients)}</p><h2>Paso a paso</h2><p>${escapeHtml(recipe.steps)}</p></body></html>`;
  const blob = new Blob(['\ufeff', documentContent], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeName = recipe.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'receta';
  link.href = url;
  link.download = `${safeName}.doc`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

(async function initialize() {
  try {
    database = await openDatabase();
  } catch (error) {
    console.error('No se pudo iniciar el almacenamiento local:', error);
    formMessage.textContent = 'El almacenamiento local no está disponible en este navegador.';
  }
})();
