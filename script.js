class ElfFile {
    constructor(name, path, contentBlob, tags = []) {
        this.id = crypto.randomUUID(); // Add unique ID for DB operations
        this.name = name;
        this.fullPath = path;
        this.contentBlob = contentBlob; // Store as Blob for lazy loading
        this.tags = tags;
    }
}

class Addr2LineConverter {
    constructor() {
        this.initDB().then(() => {
            this.loadElfFiles().then(files => {
                this.elfFiles = files;
                this.activeFileIndex = files.length > 0 ? 0 : null;
                this.setupEventListeners();
                this.renderElfFilesList();
            });
        });
        this.apiUrl = 'http://localhost:8000'; // Change in production

        window.addEventListener('beforeunload', () => {
            // Clean up any blob URLs
            this.elfFiles.forEach(file => {
                if (file.contentBlob instanceof Blob) {
                    URL.revokeObjectURL(URL.createObjectURL(file.contentBlob));
                }
            });
        });
    }

    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('addr2lineDB', 2); // Increment version for schema update

            request.onerror = () => reject(request.error);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('elfFiles')) {
                    const store = db.createObjectStore('elfFiles', { keyPath: 'id' });
                    store.createIndex('name', 'name');
                }
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
        });
    }

    async loadElfFiles() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['elfFiles'], 'readonly');
            const store = transaction.objectStore('elfFiles');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async addElfFile(elfFile) {
        const transaction = this.db.transaction(['elfFiles'], 'readwrite');
        const store = transaction.objectStore('elfFiles');
        await store.add(elfFile);
        return elfFile.id;
    }

    async updateElfFile(elfFile) {
        const transaction = this.db.transaction(['elfFiles'], 'readwrite');
        const store = transaction.objectStore('elfFiles');
        await store.put(elfFile);
    }

    async deleteElfFile(id) {
        const transaction = this.db.transaction(['elfFiles'], 'readwrite');
        const store = transaction.objectStore('elfFiles');
        await store.delete(id);
    }

    async saveElfFiles() {
        // No longer needed as individual operations are handled
    }

    setupEventListeners() {
        const inputText = document.getElementById('inputText');
        const elfFileInput = document.getElementById('elfFile');
        const elfUploadBtn = document.getElementById('elfUploadBtn');
        const textFileInput = document.getElementById('textFile');

        // ELF file drag and drop
        elfUploadBtn.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            elfUploadBtn.classList.add('dragover');
        });

        elfUploadBtn.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.relatedTarget && !elfUploadBtn.contains(e.relatedTarget)) {
                elfUploadBtn.classList.remove('dragover');
            }
        });

        elfUploadBtn.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            elfUploadBtn.classList.remove('dragover');
            
            const file = e.dataTransfer.files[0];
            if (file) {
                this.handleElfFileUpload({ target: { files: [file] } });
            }
        });

        // Text input handling
        inputText.addEventListener('input', () => this.convertText());
        inputText.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            inputText.classList.add('dragover');
        });
        inputText.addEventListener('dragleave', () => {
            inputText.classList.remove('dragover');
        });
        inputText.addEventListener('drop', (e) => {
            inputText.classList.remove('dragover');
            this.handleTextFileDrop(e);
        });

        // File input handling
        textFileInput.addEventListener('change', (e) => this.handleTextFileSelect(e));
        elfFileInput.addEventListener('change', (e) => this.handleElfFileUpload(e));

        this.initializeDragAndDrop();
    }

    async handleTextFileDrop(e) {
        e.preventDefault();
        e.stopPropagation();

        const file = e.dataTransfer.files[0];
        if (file) {
            const text = await file.text();
            document.getElementById('inputText').value = text;
            this.convertText();
        }
    }

    async handleTextFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            const text = await file.text();
            document.getElementById('inputText').value = text;
            this.convertText();
        }
        e.target.value = ''; // Reset input for reuse
    }

    clearInput() {
        document.getElementById('inputText').value = '';
        document.getElementById('outputText').textContent = '';
        inputWrapper.classList.remove('has-content');
    }

    async copyOutput() {
        const output = document.getElementById('outputText').textContent;
        try {
            await navigator.clipboard.writeText(output);
        } catch (err) {
            console.error('Failed to copy text:', err);
        }
    }

    async handleElfFileUpload(e) {
        const file = e.target.files[0];
        if (file) {
            const elfFile = new ElfFile(
                file.name,
                file.webkitRelativePath || file.path || file.name,
                file // Store the File object directly
            );
            elfFile.displayName = file.name;
            
            const id = await this.addElfFile(elfFile);
            this.elfFiles.push(elfFile);
            this.activeFileIndex = this.elfFiles.length - 1;
            this.renderElfFilesList();

            // Convert if input exists
            const inputText = document.getElementById('inputText').value;
            if (inputText.trim()) {
                await this.convertText();
            }
        }
    }

    initializeDragAndDrop() {
        const elfFilesList = document.getElementById('elfFilesList');
        new Sortable(elfFilesList, {
            animation: 150,
            handle: '.drag-handle',  // Only allow dragging by the handle
            onEnd: async (evt) => {
                const newIndex = evt.newIndex;
                const oldIndex = evt.oldIndex;

                const [movedItem] = this.elfFiles.splice(oldIndex, 1);
                this.elfFiles.splice(newIndex, 0, movedItem);
                await this.updateElfFile(movedItem);
            }
        });
    }

    renderElfFilesList() {
        const elfFilesList = document.getElementById('elfFilesList');
        elfFilesList.innerHTML = this.elfFiles.map((file, index) => `
            <li class="elf-file-item ${index === this.activeFileIndex ? 'active' : ''}" 
                data-index="${index}" >
                <i class="fas fa-grip-vertical drag-handle"></i>
                <div class="file-content" onclick="event.stopPropagation();converter.setActiveFile(${index})">
                    <span class="elf-file-name" contenteditable="true" 
                        onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}"
                        onclick="event.stopPropagation()"
                        onblur="converter.updateFileName(${index}, this.textContent)">
                        ${file.displayName || file.name}
                    </span>
                    <div class="elf-file-path" title="${file.fullPath}">
                        ${file.fullPath}
                    </div>
                    <div class="elf-file-tags">
                        ${file.tags.map(tag => `
                            <span class="tag">
                                ${tag}
                                <i class="fas fa-times" onclick="event.stopPropagation();converter.removeTag(${index}, '${tag}')"></i>
                            </span>
                        `).join('')}
                    </div>
                </div>
                <div class="file-actions" onclick="event.stopPropagation()">
                    <button onclick="event.stopPropagation();converter.addEmptyTag(${index})">
                        <i class="fas fa-tag"></i>
                    </button>
                    <button onclick="event.stopPropagation();converter.removeFile(${index})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </li>
        `).join('');
    }

    setActiveFile(index) {
        this.activeFileIndex = index;
        this.renderElfFilesList();
        this.convertText();
    }

    async convertText() {
        const inputText = document.getElementById('inputText').value;
        const outputText = document.getElementById('outputText');

        if (!inputText.trim()) {
            outputText.textContent = '';
            return;
        }

        if (this.elfFiles.length === 0 || this.activeFileIndex === null) {
            outputText.textContent = 'Please load and select an ELF file';
            return;
        }

        try {
            const formData = new FormData();
            formData.append('log_text', inputText);

            // Get the active file's content
            const activeFile = this.elfFiles[this.activeFileIndex];
            formData.append('elf_file', activeFile.contentBlob, activeFile.name);

            const apiResponse = await fetch(`${this.apiUrl}/resolve_log`, {
                method: 'POST',
                body: formData,
                mode: 'cors',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                }
            });

            if (!apiResponse.ok) {
                const errorData = await apiResponse.json();
                throw new Error(errorData.detail || 'API request failed');
            }

            const result = await apiResponse.json();
            outputText.textContent = result.resolved_log;
        } catch (error) {
            console.error('Conversion error:', error);
            outputText.textContent = 'Error during conversion: ' + error.message;
        }
    }

    addEmptyTag(index) {
        const tagsContainer = document.querySelector(`[data-index="${index}"] .elf-file-tags`);
        const newTag = document.createElement('span');
        newTag.className = 'tag editing';
        newTag.innerHTML = `
            <input type="text" placeholder="Enter tag" autofocus>
            <i class="fas fa-times"></i>
        `;

        tagsContainer.appendChild(newTag);

        const input = newTag.querySelector('input');
        input.focus();

        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                const tag = input.value.trim();
                if (tag && !this.elfFiles[index].tags.includes(tag)) {
                    await this.addTag(index, tag);
                } else {
                    newTag.remove();
                }
            } else if (e.key === 'Escape') {
                newTag.remove();
            }
        });

        input.addEventListener('blur', () => {
            setTimeout(() => newTag.remove(), 200);
        });

        newTag.querySelector('i').addEventListener('click', () => newTag.remove());
    }

    async removeTag(index, tag) {
        this.elfFiles[index].tags = this.elfFiles[index].tags.filter(t => t !== tag);
        await this.updateElfFile(this.elfFiles[index]);
        this.renderElfFilesList();
    }

    async addTag(index, tag) {
        this.elfFiles[index].tags.push(tag);
        await this.updateElfFile(this.elfFiles[index]);
        this.renderElfFilesList();
    }

    async updateFileName(index, newName) {
        this.elfFiles[index].displayName = newName;
        await this.updateElfFile(this.elfFiles[index]);
    }

    async removeFile(index) {
        const file = this.elfFiles[index];
        await this.deleteElfFile(file.id);
        this.elfFiles.splice(index, 1);
        
        if (this.activeFileIndex === index) {
            this.activeFileIndex = this.elfFiles.length > 0 ? 0 : null;
        } else if (this.activeFileIndex > index) {
            this.activeFileIndex--;
        }
        
        this.renderElfFilesList();
    }
}

// Initialize the converter
const converter = new Addr2LineConverter();
