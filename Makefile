.DEFAULT_GOAL := package
export VERSION

.PHONY: package test-package
package:
	python3 scripts/package.py

test-package:
	python3 scripts/test-package.py
