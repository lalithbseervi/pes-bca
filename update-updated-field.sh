#!/bin/bash
find content -name '*.md' | while read file; do
  # Get lastmod of markdown file
  md_lastmod=$(date -r "$file" +"%Y-%m-%dT%H:%M:%S%:z")

  # Extract template or subject_template from front matter
  template=$(awk -F'=' '/^template = / {gsub(/"/, "", $2); print $2}' "$file" | xargs)
  subject_template=$(awk -F'=' '/^subject_template = / {gsub(/"/, "", $2); print $2}' "$file" | xargs)

  # Determine template path
  tpl=""
  if [ -n "$subject_template" ]; then
    tpl="templates/$subject_template"
  elif [ -n "$template" ]; then
    tpl="templates/$template"
  fi

  # Get lastmod of template if it exists
  if [ -n "$tpl" ] && [ -f "$tpl" ]; then
    tpl_lastmod=$(date -r "$tpl" +"%Y-%m-%dT%H:%M:%S%:z")
  else
    tpl_lastmod=""
  fi

  # Choose the most recent lastmod
  if [ -n "$tpl_lastmod" ] && [[ "$tpl_lastmod" > "$md_lastmod" ]]; then
    lastmod="$tpl_lastmod"
  else
    lastmod="$md_lastmod"
  fi

  # Remove any existing updated field and insert the new one
  awk -v lastmod="$lastmod" '
    BEGIN {in_front=0; inserted=0; in_extra=0}
    /^(\+\+\+|---)$/ {
      print
      if (!in_front) { in_front=1; next }
      in_front=0; in_extra=0; next
    }
    in_front && /^updated = / { next }
    in_front && /^date = / {
      print
      print "updated = \""lastmod"\""
      inserted=1
      next
    }
    in_front && /^\[extra\]/ {
      print
      in_extra=1
      next
    }
    in_front && in_extra && !inserted && !/^updated = / && !/^\[/ {
      print "updated = \""lastmod"\""
      inserted=1
      in_extra=0
    }
    { print }
    END {
      if (in_front && !inserted) {
        print "updated = \""lastmod"\""
      }
    }
  ' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
done