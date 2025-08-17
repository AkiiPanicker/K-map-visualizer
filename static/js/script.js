document.addEventListener('DOMContentLoaded', () => {
    // --- DOM refs (existing and new) ---
    const form = document.getElementById('kmap-form');
    const outputNameInput = document.getElementById('output-name');
    const inputNamesInput = document.getElementById('input-names');
    const termsInput = document.getElementById('terms');
    const dontCaresInput = document.getElementById('dont-cares');
    const sopRadio = document.getElementById('sop');
    const posRadio = document.getElementById('pos'); // Added for direct access
    const drawKmapCheckbox = document.getElementById('draw-kmap');
    const drawGroupingsCheckbox = document.getElementById('draw-groupings');
    const resetTermsBtn = document.getElementById('reset-terms-btn');
    const resetAllBtn = document.getElementById('reset-all-btn');
    const solutionBox = document.getElementById('solution-box');
    const kmapSection = document.getElementById('kmap-section');
    const kmapContainer = document.getElementById('kmap-container');

    // New parser elements
    const problemInput = document.getElementById('problem-input');
    const parseProblemBtn = document.getElementById('parse-problem-btn');
    const parseErrorBox = document.getElementById('parse-error-box');


    // --- AUTOMATIC PROBLEM PARSER ---
    const parseAndSolve = () => {
        const text = problemInput.value.trim();
        parseErrorBox.style.display = 'none'; // Hide error box initially

        // Regex patterns to capture: 1:Func Name, 2:Vars, 3:Numbers
        const sigmaPattern = /(\w+)\s*\(([\w\s,]+)\)\s*=\s*(?:sigma|Σ)\s*m\s*\(([\d\s,]+)\)/i;
        const piPattern = /(\w+)\s*\(([\w\s,]+)\)\s*=\s*(?:pi|Π)\s*M\s*\(([\d\s,]+)\)/i;

        const sigmaMatch = text.match(sigmaPattern);
        const piMatch = text.match(piPattern);

        let match = null;
        let isMinterms = true; // True for Sigma (Σ), False for Pi (Π)

        if (sigmaMatch) {
            match = sigmaMatch;
            isMinterms = true;
        } else if (piMatch) {
            match = piMatch;
            isMinterms = false;
        } else {
            parseErrorBox.textContent = "Invalid format. Use 'F(a,b,c)=sigma m(1,2)' or 'G(x,y)=pi M(0,3)'.";
            parseErrorBox.style.display = 'block';
            return;
        }
        
        const functionName = match[1];
        const variables = match[2].split(',').map(v => v.trim());
        const numbers = match[3].split(',').filter(n => n.trim() !== '').map(n => parseInt(n.trim()));

        if (variables.length > 4 || variables.length < 2) {
            parseErrorBox.textContent = "Error: This visualizer only supports 2, 3, or 4 variables.";
            parseErrorBox.style.display = 'block';
            return;
        }

        // --- Populate the manual input fields ---
        outputNameInput.value = functionName;
        inputNamesInput.value = variables.join(', ');
        dontCaresInput.value = ''; // Clear don't cares for new problems

        if (isMinterms) {
            // It's a minterm (SOP) problem, so numbers go directly into the terms box.
            termsInput.value = numbers.join(', ');
            sopRadio.checked = true;
        } else {
            // It's a maxterm (POS) problem. We need to find the corresponding minterms.
            const numVars = variables.length;
            const allTerms = new Set(Array.from({ length: Math.pow(2, numVars) }, (_, i) => i));
            const maxterms = new Set(numbers);
            const minterms = [...allTerms].filter(term => !maxterms.has(term));
            
            termsInput.value = minterms.join(', ');
            posRadio.checked = true; // Automatically select POS for Pi notation problems
        }
        
        // Trigger the visualization
        updateVisualization();
    };

    // --- Debounce, update, and render functions (from previous version) ---
    
    const debounce = (func, delay) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => { func.apply(this, args); }, delay);
        };
    };

    const renderExplanation = (kmapData) => {
        const explanationBox = document.getElementById('explanation-box');
        const explanationSection = document.getElementById('explanation-section');
        explanationBox.innerHTML = '';
        if (!kmapData || !kmapData.explanations || kmapData.explanations.length === 0) {
            explanationSection.style.display = 'none'; return;
        }
        explanationSection.style.display = 'block';
        let introText = (kmapData.form_type === 'SOP')
            ? `<p>The <strong>Sum of Products (SOP)</strong> solution is found by creating the largest possible groups of 1s (using Don't Cares where helpful). Each group simplifies to a product term, and these terms are added together.</p>`
            : `<p>The <strong>Product of Sums (POS)</strong> solution is found by grouping the 0s. Each group simplifies to a sum term, and these terms are multiplied together.</p>`;
        const list = document.createElement('ul');
        kmapData.explanations.forEach(text => {
            const listItem = document.createElement('li');
            listItem.innerHTML = text; list.appendChild(listItem);
        });
        explanationBox.innerHTML = introText;
        explanationBox.appendChild(list);
    };
    
    const updateVisualization = async () => {
        const data = {
            output_name: outputNameInput.value.trim() || 'f', variables: inputNamesInput.value.trim(),
            minterms: termsInput.value.split(',').filter(t => t.trim() !== ''),
            dontcares: dontCaresInput.value.split(',').filter(d => d.trim() !== ''),
            form_type: sopRadio.checked ? 'SOP' : 'POS',
        };
        try {
            const response = await fetch('/solve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            const result = await response.json();
            if (response.ok) {
                solutionBox.textContent = result.solution || '0';
                renderKmap(result.kmap); renderExplanation(result.kmap);
            } else {
                solutionBox.textContent = `Error: ${result.error || 'Server error'}`;
                renderKmap(null); renderExplanation(null);
            }
        } catch (error) {
            solutionBox.textContent = 'Error communicating with server.';
            console.error('Fetch error:', error);
            renderKmap(null); renderExplanation(null);
        }
    };
    
    const debouncedUpdate = debounce(updateVisualization, 300);
    
    const getCoordsFromMinterm = (minterm, numVars) => {
        const bin = minterm.toString(2).padStart(numVars, '0');
        const grayMap = { 0: 0, 1: 1, 2: 3, 3: 2 };
        if (numVars === 2) return { r: parseInt(bin[0], 2), c: parseInt(bin[1], 2) };
        if (numVars === 3) return { r: parseInt(bin[0], 2), c: grayMap[parseInt(bin.substring(1), 2)] };
        if (numVars === 4) return { r: grayMap[parseInt(bin.substring(0, 2), 2)], c: grayMap[parseInt(bin.substring(2), 2)] };
        return null;
    };
    
    const drawGroups = (kmapData, numVars) => {
        if (!drawGroupingsCheckbox.checked || !kmapData.groups) return;
        const groupColors = ['#e06c75', '#98c379', '#61afef', '#c678dd', '#d19a66', '#56b6c2'];
        const rows = kmapData.map.length, cols = kmapData.map[0].length;
        const cells = document.querySelectorAll('#kmap-container .kmap-table tbody td');
        kmapData.groups.forEach((group, groupIndex) => {
            const color = groupColors[groupIndex % groupColors.length];
            const groupCoords = new Set(group.map(m => `${getCoordsFromMinterm(m, numVars).r},${getCoordsFromMinterm(m, numVars).c}`));
            groupCoords.forEach(coordStr => {
                const [r_str, c_str] = coordStr.split(','), r = parseInt(r_str), c = parseInt(c_str);
                const cell = cells[r * cols + c];
                const topN = `${(r - 1 + rows) % rows},${c}`, bottomN = `${(r + 1) % rows},${c}`, leftN = `${r},${(c - 1 + cols) % cols}`, rightN = `${r},${(c + 1) % cols}`;
                if (!groupCoords.has(topN)) cell.style.borderTop = `3px solid ${color}`;
                if (!groupCoords.has(bottomN)) cell.style.borderBottom = `3px solid ${color}`;
                if (!groupCoords.has(leftN)) cell.style.borderLeft = `3px solid ${color}`;
                if (!groupCoords.has(rightN)) cell.style.borderRight = `3px solid ${color}`;
            });
        });
    };

    const renderKmap = (kmapData) => {
        const numVars = inputNamesInput.value.split(',').filter(v => v.trim()).length;
        if (!drawKmapCheckbox.checked || !kmapData || !kmapData.map) {
            kmapSection.classList.remove('visible'); kmapContainer.innerHTML = ''; return;
        }
        kmapSection.classList.add('visible'); kmapContainer.innerHTML = '';
        const table = document.createElement('table'); table.className = 'kmap-table';
        const thead = table.createTHead();
        thead.insertRow().innerHTML = `<th class="corner-label func-name">${kmapData.output_name}</th><th class="corner-label col-vars" colspan="${kmapData.col_labels.length}">${kmapData.col_vars}</th>`;
        const headerRow2 = thead.insertRow();
        headerRow2.innerHTML = `<th class="corner-label row-vars">${kmapData.row_vars}</th>`;
        kmapData.col_labels.forEach(label => headerRow2.innerHTML += `<th class="label-header">${label}</th>`);
        const tbody = table.createTBody();
        kmapData.map.forEach((rowData, i) => {
            const row = tbody.insertRow(); row.innerHTML = `<th class="label-header">${kmapData.row_labels[i]}</th>`;
            rowData.forEach(cellData => {
                const cell = row.insertCell(); cell.textContent = cellData;
                if (cellData === '1') cell.className = 'is-one'; if (cellData === 'X') cell.className = 'is-x';
            });
        });
        kmapContainer.appendChild(table);
        drawGroups(kmapData, numVars);
    };

    // --- UPDATED EVENT LISTENERS ---
    parseProblemBtn.addEventListener('click', parseAndSolve);

    form.addEventListener('input', debouncedUpdate);
    document.querySelectorAll('input[name="form-type"]').forEach(radio => radio.addEventListener('change', updateVisualization));
    drawKmapCheckbox.addEventListener('change', updateVisualization);
    drawGroupingsCheckbox.addEventListener('change', updateVisualization);

    resetTermsBtn.addEventListener('click', () => { termsInput.value = ''; dontCaresInput.value = ''; updateVisualization(); });

    resetAllBtn.addEventListener('click', () => {
        outputNameInput.value = 'f';
        inputNamesInput.value = 'a, b, c, d';
        termsInput.value = ''; dontCaresInput.value = '';
        problemInput.value = ''; // Also clear the problem input
        parseErrorBox.style.display = 'none'; // And hide any error
        sopRadio.checked = true;
        drawKmapCheckbox.checked = true;
        drawGroupingsCheckbox.checked = true;
        updateVisualization();
    });
    
    // Initial call to display default state
    updateVisualization();
});
