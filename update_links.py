#!/usr/bin/env python3
import os
import re
import glob

def find_new_file(old_filename):
    """Find the new filename for an old filename by looking for similar files"""
    # Extract the meaningful part before the UUID
    parts = old_filename.split('_')
    
    # Find the base name (before UQ25...)
    base_parts = []
    for part in parts:
        if part.startswith('UQ25'):
            break
        base_parts.append(part)
    
    if not base_parts:
        # If no meaningful parts found, try to match by subject/topic
        if 'cfp' in old_filename.lower():
            subject = 'cfp'
        elif 'mfca' in old_filename.lower():
            subject = 'mfca'
        elif 'pce' in old_filename.lower():
            subject = 'pce'
        elif 'wd' in old_filename.lower():
            subject = 'wd'
        else:
            return None
            
        # Try to find files in the same directory structure
        dir_path = os.path.dirname(old_filename)
        if os.path.exists(f"static/{dir_path}"):
            files = os.listdir(f"static/{dir_path}")
            for file in files:
                if file.endswith('.pdf') and subject.upper() in file:
                    return f"{dir_path}/{file}"
    
    # Try to find the new file with simplified name
    base_name = '_'.join(base_parts)
    dir_path = os.path.dirname(old_filename)
    
    # Search for files with similar names
    search_pattern = f"static/{dir_path}/*{base_name}*.pdf"
    matches = glob.glob(search_pattern)
    
    if matches:
        # Return the first match, removing 'static/' prefix
        return matches[0].replace('static/', '', 1)
    
    # Try searching with just the first meaningful part
    if base_parts:
        search_pattern = f"static/{dir_path}/*{base_parts[0]}*.pdf"
        matches = glob.glob(search_pattern)
        if matches:
            return matches[0].replace('static/', '', 1)
    
    return None

def update_html_file(html_file):
    """Update all href links in an HTML file"""
    with open(html_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Find all href attributes with PDF files
    href_pattern = r'href="([^"]*\.pdf)"'
    matches = re.finditer(href_pattern, content)
    
    updates = 0
    for match in matches:
        old_path = match.group(1)
        if old_path.startswith('/'):
            old_path = old_path[1:]  # Remove leading slash
        
        # Check if file exists
        if not os.path.exists(f"static/{old_path}"):
            new_path = find_new_file(old_path)
            if new_path:
                print(f"Updating: {old_path} -> {new_path}")
                content = content.replace(f'href="/{old_path}"', f'href="/{new_path}"')
                content = content.replace(f'href="{old_path}"', f'href="/{new_path}"')
                updates += 1
            else:
                print(f"Warning: Could not find replacement for {old_path}")
    
    if updates > 0:
        with open(html_file, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated {updates} links in {html_file}")
    else:
        print(f"No updates needed for {html_file}")

if __name__ == "__main__":
    # Update the main index.html file
    update_html_file("templates/index.html")
    
    # You can add other HTML files here if needed
    # update_html_file("templates/other.html")