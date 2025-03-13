# python-template

Use this repository as a template to create a python project.
This repository includes:

* pyproject.toml
* ASL 2.0 License
* example-readme.md
* Security.md
* Code of Conduct
* Contributing
* .pre-commit-config.yaml
* [python-template example module](python-template/README.md)
* [tests](tests/README.md)

## pyproject.toml

The template has a base [pyproject.toml](https://packaging.python.org/en/latest/specifications/pyproject-toml/). This is where all project metadata for the python project should be stored.
The pyproject.toml uses a [hatch backend](https://hatch.pypa.io/latest/config/metadata/) for building python package.

Remember to replace all references to python-template inside the pyproject.toml and to update the [classifiers](https://pypi.org/classifiers/)

## License

The template comes with ASL 2.0 License

## Example Readme

Replace this README.md file with the templated EXAMPLE_README.md.

## Security

The template comes with the default aiven security policy for reporting security issues with a repository

## Code of Conduct

The template comes with the default aiven code of conduct policy

## Contributing

The template comes with a template CONTRIBUTING.md file. Fill in this template to explain how other developers can contribute to the project.

## .pre-commit-config.yaml

The template comes with a base pre-commit-config that can be used to lint and format the code before commits and push
