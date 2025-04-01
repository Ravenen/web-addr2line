class ElfFile {
    constructor(name, path, content, tags = []) {
        this.name = name;
        this.fullPath = path;  // Store the full path separately
        this.content = content;
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
    }

    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('addr2lineDB', 1);

            request.onerror = () => reject(request.error);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('elfFiles')) {
                    db.createObjectStore('elfFiles', { keyPath: 'id', autoIncrement: true });
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

    async saveElfFiles() {
        const transaction = this.db.transaction(['elfFiles'], 'readwrite');
        const store = transaction.objectStore('elfFiles');

        // Clear existing records
        const clearRequest = store.clear();
        await new Promise((resolve, reject) => {
            clearRequest.onsuccess = resolve;
            clearRequest.onerror = reject;
        });

        // Add all current files
        for (const file of this.elfFiles) {
            const addRequest = store.add(file);
            await new Promise((resolve, reject) => {
                addRequest.onsuccess = resolve;
                addRequest.onerror = reject;
            });
        }
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
            // Read file content
            const arrayBuffer = await file.arrayBuffer();
            const content = Array.from(new Uint8Array(arrayBuffer));

            let fullPath = file.webkitRelativePath || file.path || file.name;
            if (fullPath === file.name) {
                try {
                    fullPath = e.target.files[0].mozFullPath || file.name;
                } catch (e) {
                    fullPath = file.name;
                }
            }

            const elfFile = new ElfFile(
                file.name,
                fullPath,
                content
            );
            elfFile.displayName = file.name;
            this.elfFiles.push(elfFile);
            await this.saveElfFiles();
            this.activeFileIndex = this.elfFiles.length - 1;
            this.renderElfFilesList();
            
            // Trigger conversion if there's input text
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
                await this.saveElfFiles();
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

            // Convert stored content back to blob
            const activeFile = this.elfFiles[this.activeFileIndex];
            const fileBlob = new Blob([new Uint8Array(activeFile.content)]);
            formData.append('elf_file', fileBlob, activeFile.name);

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

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const tag = input.value.trim();
                if (tag && !this.elfFiles[index].tags.includes(tag)) {
                    this.elfFiles[index].tags.push(tag);
                    this.saveElfFiles();
                    this.renderElfFilesList();
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

    removeTag(index, tag) {
        this.elfFiles[index].tags = this.elfFiles[index].tags.filter(t => t !== tag);
        this.saveElfFiles();
        this.renderElfFilesList();
    }

    updateFileName(index, newName) {
        this.elfFiles[index].displayName = newName;
        this.saveElfFiles();
    }

    async removeFile(index) {
        this.elfFiles.splice(index, 1);
        if (this.activeFileIndex === index) {
            this.activeFileIndex = this.elfFiles.length > 0 ? 0 : null;
        } else if (this.activeFileIndex > index) {
            this.activeFileIndex--;
        }
        await this.saveElfFiles();
        this.renderElfFilesList();
    }

    async fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    async base64ToBlob(base64) {
        const response = await fetch(base64);
        return response.blob();
    }
}

// Initialize the converter
const converter = new Addr2LineConverter();
