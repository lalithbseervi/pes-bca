#!/bin/bash

most_recent=""
most_recent_file=""

while read -r file; do
  md_lastmod=$(date -r "$file" +"%Y-%m-%dT%H:%M:%S%:z")
  template=$(awk -F'=' '/^template = / {gsub(/"/, "", $2); print $2}' "$file" | xargs)
  subject_template=$(awk -F'=' '/^subject_template = / {gsub(/"/, "", $2); print $2}' "$file" | xargs)
  tpl=""
  if [ -n "$subject_template" ]; then
    tpl="templates/$subject_template"
  elif [ -n "$template" ]; then
    tpl="templates/$template"
  fi
  if [ -n "$tpl" ] && [ -f "$tpl" ]; then
    tpl_lastmod=$(date -r "$tpl" +"%Y-%m-%dT%H:%M:%S%:z")
  else
    tpl_lastmod=""
  fi

  if [ -n "$tpl_lastmod" ] && [[ "$tpl_lastmod" > "$md_lastmod" ]]; then
    lastmod="$tpl_lastmod"
    lastmod_file="$tpl"
  else
    lastmod="$md_lastmod"
    lastmod_file="$file"
  fi

  if [[ -z "$most_recent" || "$lastmod" > "$most_recent" ]]; then
    most_recent="$lastmod"
    most_recent_file="$lastmod_file"
  fi
done < <(find content -name '*.md')

if [ -n "$most_recent_file" ]; then
  formatted=$(date -r "$most_recent_file" +"%d-%m-%Y, %H:%M:%S")
  target="templates/index.html"
  tmpfile=$(mktemp)
  sed "89s/\\(Last Updated: \\)[^<]*/\\1$formatted/" "$target" > "$tmpfile" && mv "$tmpfile" "$target"
else
  echo "No markdown or template files found to determine last updated time."
  exit 1
fi