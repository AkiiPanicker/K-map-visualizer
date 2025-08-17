import json
from flask import Flask, render_template, request, jsonify
from sympy.logic import boolalg
from sympy import symbols, Not, And, Or
import re

app = Flask(__name__)

# --- NEW FUNCTION to convert a group of minterms to a simplified algebraic term ---
def group_to_term(group_minterms, variables, form_type):
    """
    Derives the simplified algebraic term from a list of minterms representing a group.
    Example: group [4, 5, 6, 7] with variables [a,b,c,d] -> "a'b"
    """
    if not group_minterms:
        return ""

    num_vars = len(variables)
    
    # Convert all minterms to binary strings
    bin_strings = [format(m, f'0{num_vars}b') for m in group_minterms]
    
    term_parts = []
    # Iterate through each variable/bit position
    for i in range(num_vars):
        first_bit = bin_strings[0][i]
        # Check if this bit is constant across all minterms in the group
        if all(b[i] == first_bit for b in bin_strings):
            var_name = str(variables[i]) + "'"
            
            # For SOP, a constant 0 is prime (a'), a constant 1 is normal (a)
            # For POS, a constant 0 is normal (a), a constant 1 is prime (a')
            if (form_type == 'SOP' and first_bit == '1') or \
               (form_type == 'POS' and first_bit == '0'):
                var_name = str(variables[i])
            
            term_parts.append(var_name)
    
    if not term_parts:
        return "1"

    # Join the parts based on the form type
    if form_type == 'SOP':
        return "".join(term_parts) # e.g., a'b
    else: # POS
        return f"({' + '.join(term_parts)})" # e.g., (a+b')


# --- HELPER FUNCTIONS (UNCHANGED) ---
def get_minterms_for_term(term, variables):
    """
    Expands a single product term (like a'b) into the list of minterms it covers.
    """
    num_vars = len(variables)
    covered_minterms, fixed_vars = [], {}
    term_args = term.args if isinstance(term, (And, Or)) else (term,)
    for arg in term_args:
        if isinstance(arg, Not):
            fixed_vars[str(arg.args[0])] = 0
        else:
            fixed_vars[str(arg)] = 1
    for i in range(2**num_vars):
        is_covered, bin_str = True, format(i, f'0{num_vars}b')
        for var_index, var_symbol in enumerate(variables):
            var_name = str(var_symbol)
            if var_name in fixed_vars and int(bin_str[var_index]) != fixed_vars[var_name]:
                is_covered = False; break
        if is_covered: covered_minterms.append(i)
    return covered_minterms

def get_implicant_groups(minimized_expr, variables):
    """
    Takes a minimized SymPy SOP expression and returns a list of groups,
    where each group is a list of minterms.
    """
    if minimized_expr in [True, False]: return []
    terms = minimized_expr.args if isinstance(minimized_expr, Or) else [minimized_expr]
    return [get_minterms_for_term(term, variables) for term in terms]

def format_sympy_expr(expr_obj, var_names, form_type):
    if expr_obj is True: return "1"
    if expr_obj is False: return "0"
    expr_str = str(expr_obj)
    for var in sorted(var_names, key=len, reverse=True):
        expr_str = expr_str.replace(f"~{var}", f"{var}'")
    if form_type == 'SOP':
        return expr_str.replace(" & ", "").replace(" | ", " + ")
    else: # POS
        return re.sub(r'\) & \(', ') (', expr_str.replace(" | ", " + ").replace(" & ", ""))

def generate_kmap(variables, minterms, dontcares, output_name):
    num_vars = len(variables)
    if num_vars not in [2, 3, 4]: return None
    rows, cols = (4, 4) if num_vars == 4 else ((2, 4) if num_vars == 3 else (2, 2))
    row_vars, col_vars = variables[:num_vars//2], variables[num_vars//2:]
    row_labels = ["0", "1"] if len(row_vars) == 1 else ["00", "01", "11", "10"]
    col_labels = ["0", "1"] if len(col_vars) == 1 else ["00", "01", "11", "10"]
    gray_map = {0: 0, 1: 1, 2: 3, 3: 2}
    kmap = [["0"] * cols for _ in range(rows)]
    all_terms = {m: "1" for m in minterms}; all_terms.update({d: "X" for d in dontcares})
    for i in range(2**num_vars):
        val, bin_str = all_terms.get(i, "0"), format(i, f'0{num_vars}b')
        r_bin, c_bin = int(bin_str[:len(row_vars)], 2) if row_vars else 0, int(bin_str[len(row_vars):], 2) if col_vars else 0
        r, c = gray_map.get(r_bin, r_bin), gray_map.get(c_bin, c_bin)
        kmap[r][c] = val
    return {"map": kmap, "row_labels": row_labels, "col_labels": col_labels, "row_vars": ",".join(row_vars), "col_vars": ",".join(col_vars), "output_name": output_name}

# --- FLASK ROUTES ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/solve', methods=['POST'])
def solve_kmap():
    try:
        data = request.get_json()
        var_names = [v.strip() for v in data.get('variables', 'a,b,c,d').split(',') if v.strip()]
        output_name = data.get('output_name', 'f').strip()
        minterms = [int(t) for t in data.get('minterms', []) if t.strip()]
        dontcares = [int(d) for d in data.get('dontcares', []) if d.strip()]
        form_type = data.get('form_type', 'SOP')
        
        if not var_names or (not minterms and not dontcares):
            kmap_data = generate_kmap(var_names or ['a', 'b', 'c', 'd'], [], [], output_name)
            kmap_data.update({'groups': [], 'explanations': [], 'form_type': form_type})
            return jsonify({'solution': '0', 'kmap': kmap_data})
        if len(var_names) not in [2, 3, 4]:
            return jsonify({'error': f"{len(var_names)} variables not supported (2-4 only)."}), 400

        variables = symbols(','.join(var_names))
        if not isinstance(variables, tuple): variables = (variables,)

        groups, explanations = [], []
        terms_to_group, term_name_in_explanation = [], ""
        
        if form_type == 'SOP':
            minimized_expr = boolalg.SOPform(variables, minterms, dontcares)
            groups = get_implicant_groups(minimized_expr, variables)
            terms_to_group = minterms
            term_name_in_explanation = "1s"
        else: # POS
            minimized_expr = boolalg.POSform(variables, minterms, dontcares)
            maxterms = list(set(range(2**len(variables))) - set(minterms) - set(dontcares))
            sop_of_zeros_expr = boolalg.SOPform(variables, maxterms, dontcares)
            groups = get_implicant_groups(sop_of_zeros_expr, variables)
            terms_to_group = maxterms
            term_name_in_explanation = "0s"
        
        # --- GENERATE EXPLANATIONS FOR EACH GROUP ---
        for group in groups:
            # Filter out don't cares from the explanation string for clarity
            relevant_terms = sorted([m for m in group if m in terms_to_group])
            if not relevant_terms: continue # Skip groups that only cover don't cares
            
            algebraic_term = group_to_term(group, variables, form_type)
            explanation = (f"A group is formed around the {term_name_in_explanation} at positions "
                           f"<strong>{str(relevant_terms)}</strong>. This simplifies to the term "
                           f"<code>{algebraic_term}</code>.")
            explanations.append(explanation)
        
        solution_str = format_sympy_expr(minimized_expr, var_names, form_type)
        kmap_data = generate_kmap(var_names, minterms, dontcares, output_name)
        kmap_data.update({
            'groups': groups,
            'explanations': explanations,
            'form_type': form_type
        })

        return jsonify({'solution': solution_str, 'kmap': kmap_data})
    except Exception as e:
        return jsonify({'error': f"An unexpected server error occurred: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(debug=True)
