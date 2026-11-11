#pragma once
#include <string>
#include <cctype>
class String : public std::string {
public:
  using std::string::string;
  String(const std::string &value) : std::string(value) {}
  bool isEmpty() const { return empty(); }
};
