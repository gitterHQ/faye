#!/bin/bash

set -e
set -x

fswatch -0 . --exclude=.git --exclude=.wake.json --exclude=build/ --exclude=opensource/faye/lib/| while read -d "" event; do
  echo change $event;
  wake;
  if node spec/node.js; then
    cp build/browser/faye-browser.js ../../gitter/webapp/public/repo/faye/faye.js;
  fi
done
