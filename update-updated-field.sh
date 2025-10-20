#!/bin/bash
find content -name '*.md' | while read file; do
  lastmod=$(date -r "$file" +"%Y-%m-%dT%H:%M:%S%:z")
  awk -v lastmod="$lastmod" '
    BEGIN {in_front=0; inserted=0; in_extra=0}
    # Start of TOML front matter
    /^(\+\+\+|---)$/ {
      print
      if (!in_front) { in_front=1; next }
      # End of front matter
      in_front=0
      in_extra=0
      next
    }
    # Remove any existing updated field in front matter
    in_front && /^updated = / { next }
    # Insert after date
    in_front && /^date = / {
      print
      print "updated = \""lastmod"\""
      inserted=1
      next
    }
    # Insert as first entry under [extra]
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
      # If still in front matter and not inserted, add updated at the end of front matter
      if (in_front && !inserted) {
        print "updated = \""lastmod"\""
      }
    }
  ' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
done